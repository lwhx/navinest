import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { getPublicContentFile } from '$lib/server/services/public-content-files';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE files(id INTEGER PRIMARY KEY,object_key TEXT,mime_type TEXT);CREATE TABLE items(id INTEGER PRIMARY KEY,icon_file_id INTEGER,cover_file_id INTEGER,status TEXT,visibility TEXT);INSERT INTO files VALUES(1,'uploads/icon.png','image/png'),(2,'uploads/private.png','image/png');INSERT INTO items VALUES(1,1,NULL,'published','public'),(2,2,NULL,'draft','public');`
	);
	const db: Database = {
		prepare(q) {
			let v: DatabaseValue[] = [];
			const s: DatabaseStatement = {
				bind(...x) {
					v = x;
					return s;
				},
				async all<T>() {
					return {
						results: sqlite
							.prepare(q)
							.all(
								...v.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value))
							) as T[]
					};
				}
			};
			return s;
		}
	};
	return db;
}
afterEach(() => connections.splice(0).forEach((x) => x.close()));
describe('public content files', () => {
	it('returns only files referenced by published public content', async () => {
		const db = fixture();
		expect(await getPublicContentFile(db, 1)).toMatchObject({
			objectKey: 'uploads/icon.png',
			mimeType: 'image/png'
		});
		expect(await getPublicContentFile(db, 2)).toBeNull();
	});
});
