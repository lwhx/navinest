import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { UserFileError, deleteOwnedFile, getOwnedFile } from '$lib/server/services/user-files';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
		CREATE TABLE users(id INTEGER PRIMARY KEY,avatar_file_id INTEGER,cover_file_id INTEGER);
		CREATE TABLE files(id INTEGER PRIMARY KEY,user_id INTEGER,bucket TEXT,object_key TEXT,mime_type TEXT,size INTEGER,public_url TEXT,width INTEGER,height INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
		INSERT INTO users VALUES(7,NULL,NULL),(8,NULL,NULL);
		INSERT INTO files(id,user_id,bucket,object_key,mime_type,size) VALUES(1,7,'FILES','uploads/avatar.png','image/png',3),(2,8,'FILES','uploads/other.png','image/png',3);
	`);
	const database: Database = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement: DatabaseStatement = {
				bind(...next) {
					values = next;
					return statement;
				},
				async all<T>() {
					return {
						results: sqlite
							.prepare(query)
							.all(...values.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v))) as T[]
					};
				}
			};
			return statement;
		}
	};
	const objects = new Map([
		['uploads/avatar.png', new Uint8Array([1, 2, 3]).buffer],
		['uploads/other.png', new Uint8Array([4, 5, 6]).buffer]
	]);
	const bucket = {
		async delete(key: string) {
			objects.delete(key);
		}
	};
	return { sqlite, database, objects, bucket };
}
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('owned user files', () => {
	it('returns only files owned by the current user', async () => {
		const { database } = fixture();
		await expect(getOwnedFile(database, 7, 1)).resolves.toMatchObject({
			id: 1,
			objectKey: 'uploads/avatar.png',
			mimeType: 'image/png'
		});
		await expect(getOwnedFile(database, 7, 2)).rejects.toBeInstanceOf(UserFileError);
	});
	it('blocks referenced files and deletes orphaned D1 and R2 data', async () => {
		const { database, sqlite, objects, bucket } = fixture();
		sqlite.prepare('UPDATE users SET avatar_file_id=1 WHERE id=7').run();
		await expect(deleteOwnedFile(database, bucket, 7, 1)).rejects.toMatchObject({ status: 409 });
		sqlite.prepare('UPDATE users SET avatar_file_id=NULL WHERE id=7').run();
		await deleteOwnedFile(database, bucket, 7, 1);
		expect(objects.has('uploads/avatar.png')).toBe(false);
		expect(sqlite.prepare('SELECT COUNT(*) count FROM files WHERE id=1').get()).toMatchObject({
			count: 0
		});
	});
	it('does not allow one user to delete another user file', async () => {
		const { database, bucket } = fixture();
		await expect(deleteOwnedFile(database, bucket, 7, 2)).rejects.toBeInstanceOf(UserFileError);
	});
});
