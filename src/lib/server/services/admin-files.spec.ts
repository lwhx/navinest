import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	AdminFileError,
	createFileObjectKey,
	deleteAdminFile,
	listAdminFiles,
	storeAdminFile,
	validateAdminUpload,
	type FileBucket
} from '$lib/server/services/admin-files';

const connections: DatabaseSync[] = [];

function createContext() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE users (id INTEGER PRIMARY KEY);
		CREATE TABLE files (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
			bucket TEXT NOT NULL,
			object_key TEXT NOT NULL UNIQUE,
			public_url TEXT,
			mime_type TEXT,
			size INTEGER,
			width INTEGER,
			height INTEGER,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE items (
			id INTEGER PRIMARY KEY,
			title TEXT,
			cover_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
			icon_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL
		);
	`);
	const database: Database = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement: DatabaseStatement = {
				bind(...nextValues) {
					values = nextValues;
					return statement;
				},
				async all<T>() {
					const sqliteValues = values.map((value) =>
						value instanceof ArrayBuffer ? new Uint8Array(value) : value
					);
					return { results: sqlite.prepare(query).all(...sqliteValues) as T[] };
				}
			};
			return statement;
		}
	};
	const objects = new Map<string, ArrayBuffer>();
	const bucket: FileBucket = {
		async put(key, value) {
			objects.set(key, value);
		},
		async delete(key) {
			objects.delete(key);
		}
	};
	return { database, bucket, objects, sqlite };
}

afterEach(() => {
	for (const connection of connections.splice(0)) connection.close();
});

describe('administrator file validation', () => {
	it('accepts supported images and creates opaque dated object keys', () => {
		const file = new File(['image'], 'My Cover.PNG', { type: 'image/png' });
		expect(validateAdminUpload(file)).toEqual({ valid: true, extension: 'png' });
		expect(
			validateAdminUpload(new File(['icon'], 'favicon.ico', { type: 'image/x-icon' }))
		).toEqual({
			valid: true,
			extension: 'ico'
		});
		expect(createFileObjectKey('png', new Date('2026-07-12T10:00:00Z'), 'abc-123')).toBe(
			'uploads/2026/07/abc-123.png'
		);
	});

	it('rejects unsupported and oversized uploads', () => {
		expect(
			validateAdminUpload(new File(['text'], 'note.txt', { type: 'text/plain' }))
		).toMatchObject({ valid: false });
		expect(
			validateAdminUpload(
				new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' })
			)
		).toMatchObject({ valid: false });
	});
});

describe('administrator file storage', () => {
	it('lists content references and their icon or cover usage', async () => {
		const { database, sqlite } = createContext();
		sqlite.exec(`
			INSERT INTO files(id,bucket,object_key,mime_type) VALUES
				(1,'FILES','used.png','image/png'),(2,'FILES','free.png','image/png');
			INSERT INTO items(id,title,icon_file_id,cover_file_id) VALUES
				(10,'Cloudflare',1,NULL),(11,'Design Book',NULL,1);
		`);
		const files = await listAdminFiles(database);
		expect(files.find((file) => file.id === 1)?.references).toEqual([
			{ itemId: 10, title: 'Cloudflare', usage: 'icon' },
			{ itemId: 11, title: 'Design Book', usage: 'cover' }
		]);
		expect(files.find((file) => file.id === 2)?.references).toEqual([]);
	});

	it('stores an R2 object and matching D1 index, then deletes both', async () => {
		const { database, bucket, objects, sqlite } = createContext();
		const file = new File(['image'], 'cover.png', { type: 'image/png' });
		const record = await storeAdminFile({
			database,
			bucket,
			file,
			userId: null,
			now: new Date('2026-07-12T10:00:00Z'),
			id: 'file-id'
		});

		expect(record).toMatchObject({
			objectKey: 'uploads/2026/07/file-id.png',
			mimeType: 'image/png',
			size: 5
		});
		expect(objects.has(record.objectKey)).toBe(true);
		expect(
			sqlite.prepare('SELECT object_key, bucket, size FROM files WHERE id = ?').get(record.id)
		).toEqual({ object_key: record.objectKey, bucket: 'FILES', size: 5 });

		await deleteAdminFile(database, bucket, record.id);
		expect(objects.has(record.objectKey)).toBe(false);
		expect(sqlite.prepare('SELECT COUNT(*) AS count FROM files').get()).toEqual({ count: 0 });
	});

	it('does not delete files referenced by content', async () => {
		const { database, bucket, sqlite } = createContext();
		const record = await storeAdminFile({
			database,
			bucket,
			file: new File(['x'], 'icon.webp', { type: 'image/webp' }),
			userId: null,
			id: 'used-file'
		});
		sqlite.prepare('INSERT INTO items (id, icon_file_id) VALUES (1, ?)').run(record.id);
		await expect(deleteAdminFile(database, bucket, record.id)).rejects.toBeInstanceOf(
			AdminFileError
		);
	});
});
