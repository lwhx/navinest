import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateUserProfile } from '$lib/server/user-profile';
import { mediaFilters, mediaQuery } from '$lib/media-library';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	AdminFileError,
	createFileObjectKey,
	deleteAdminFile,
	listAdminFiles,
	loadMediaPage,
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
		CREATE TABLE users (id INTEGER PRIMARY KEY,display_name TEXT,avatar_file_id INTEGER,cover_file_id INTEGER);
		CREATE TABLE submissions(id INTEGER PRIMARY KEY,title TEXT,status TEXT,payload_json TEXT);
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
			{ kind: 'item', id: 10, title: 'Cloudflare', usage: 'icon' },
			{ kind: 'item', id: 11, title: 'Design Book', usage: 'cover' }
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

describe('media library filtering and deletion protection', () => {
	it('paginates the complete library with stable counts and can find files beyond the old 200 cap', async () => {
		const { database, sqlite } = createContext();
		const insert = sqlite.prepare(
			"INSERT INTO files(id,bucket,object_key,mime_type,size,created_at) VALUES(?,'FILES',?,'image/png',?,'2026-10-16 12:00:00')"
		);
		for (let id = 1; id <= 225; id++) insert.run(id, `library-${id}.png`, id);
		const first = await loadMediaPage(database);
		expect(first.total).toBe(225);
		expect(first.pageCount).toBe(10);
		expect(first.files.map((f) => f.id)).toEqual(Array.from({ length: 24 }, (_, i) => 225 - i));
		const last = await loadMediaPage(database, new URLSearchParams('page=999'));
		expect(last.filters.page).toBe(10);
		expect(last.files.map((f) => f.id)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
		const search = await loadMediaPage(database, new URLSearchParams('q=library-1.png'));
		expect(search.total).toBe(1);
		expect(search.files[0].id).toBe(1);
	});
	it('shows all live usage kinds and applies the same protection to used/unused filters and deletion', async () => {
		const { database, sqlite, bucket } = createContext();
		sqlite.exec(
			"INSERT INTO files(id,bucket,object_key,mime_type) VALUES(1,'FILES','avatar.png','image/png'),(2,'FILES','profile.png','image/png'),(3,'FILES','pending.png','image/png'),(4,'FILES','reviewing.png','image/png'),(5,'FILES','rejected.png','image/png'); INSERT INTO users(id,display_name,avatar_file_id,cover_file_id) VALUES(7,'测试用户',1,2); INSERT INTO submissions VALUES(10,'等待审核','pending','{\"iconFileId\":3}'),(11,'正在审核','reviewing','{\"iconFileId\":4}'),(12,'已拒绝','rejected','{\"iconFileId\":5}'),(13,'历史损坏','pending','bad-json')"
		);
		const used = await loadMediaPage(database, new URLSearchParams('usage=used'));
		expect(used.files.map((f) => f.id)).toEqual([4, 3, 2, 1]);
		expect(used.files.flatMap((f) => f.references.map((r) => r.usage)).sort()).toEqual([
			'avatar',
			'profileCover',
			'submission',
			'submission'
		]);
		for (const file of used.files)
			await expect(deleteAdminFile(database, bucket, file.id)).rejects.toMatchObject({
				status: 409
			});
		const unused = await loadMediaPage(database, new URLSearchParams('usage=unused'));
		expect(unused.files.map((f) => f.id)).toEqual([5]);
		const search = await loadMediaPage(database, new URLSearchParams('q=正在审核'));
		expect(search.files[0].id).toBe(4);
	});
	it('combines date, format, literal search and ordering without exposing other buckets', async () => {
		const { database, sqlite, bucket } = createContext();
		sqlite.exec(
			"INSERT INTO files(id,bucket,object_key,mime_type,size,created_at) VALUES(1,'FILES','literal%_.png','image/png',4,'2026-10-10'),(2,'FILES','another.png','image/png',8,'2026-10-11'),(3,'FILES','old.webp','image/webp',20,'2026-09-09'),(4,'ARCHIVE','protected.png','image/png',99,'2026-10-11'),(5,'FILES','icon.ico','image/vnd.microsoft.icon',1,'2026-10-12')"
		);
		expect(
			(await loadMediaPage(database, new URLSearchParams('q=%25_'))).files.map((f) => f.id)
		).toEqual([1]);
		expect(
			(
				await loadMediaPage(
					database,
					new URLSearchParams('from=2026-10-10&to=2026-10-11&kind=png&order=size')
				)
			).files.map((f) => f.id)
		).toEqual([2, 1]);
		expect(
			(await loadMediaPage(database, new URLSearchParams('kind=ico'))).files.map((f) => f.id)
		).toEqual([5]);
		await expect(deleteAdminFile(database, bucket, 4)).rejects.toMatchObject({ status: 409 });
		for (const q of ['all', 'newest'])
			expect(new URLSearchParams(mediaQuery({ ...mediaFilters(), q })).get('q')).toBe(q);
		const filters = mediaFilters(
			new URLSearchParams('page=Infinity&from=2026-02-30&to=bad&q=你好&kind=invalid')
		);
		expect(filters).toMatchObject({ page: 1, from: '', to: '', q: '你好', kind: 'all' });
		expect(
			mediaFilters(new URLSearchParams(mediaQuery({ ...filters, usage: 'used' }, 3)))
		).toMatchObject({ q: '你好', usage: 'used', page: 3 });
	});
	it('rechecks references in the same statement that removes the index', async () => {
		const { database, sqlite, bucket } = createContext();
		sqlite.exec(
			"INSERT INTO files(id,bucket,object_key) VALUES(1,'FILES','late.png'); INSERT INTO users(id,display_name) VALUES(7,'晚到的引用')"
		);
		const deletion = vi.spyOn(bucket, 'delete');
		const concurrent: Database = {
			prepare(query) {
				if (query.startsWith('DELETE FROM files'))
					sqlite.exec('UPDATE users SET avatar_file_id=1 WHERE id=7');
				return database.prepare(query);
			}
		};
		await expect(deleteAdminFile(concurrent, bucket, 1)).rejects.toMatchObject({ status: 409 });
		expect(deletion).not.toHaveBeenCalled();
		expect(sqlite.prepare('SELECT id FROM files').get()).toEqual({ id: 1 });
	});
	it('restores the full index after storage failure and permits an explicit retry', async () => {
		const { database, sqlite, bucket, objects } = createContext();
		const file = await storeAdminFile({
			database,
			bucket,
			file: new File(['abc'], 'x.png', { type: 'image/png' }),
			userId: null,
			id: 'retry'
		});
		const original = sqlite.prepare('SELECT * FROM files').get();
		vi.spyOn(bucket, 'delete').mockRejectedValueOnce(new Error('storage failure'));
		await expect(deleteAdminFile(database, bucket, file.id)).rejects.toThrow('storage failure');
		expect(sqlite.prepare('SELECT * FROM files').get()).toEqual(original);
		expect(objects.has(file.objectKey)).toBe(true);
		await deleteAdminFile(database, bucket, file.id);
		expect(objects.size).toBe(0);
	});
	it('does not let a profile save attach a file removed after initial validation', async () => {
		const { database, sqlite } = createContext();
		sqlite.exec(
			"ALTER TABLE users ADD COLUMN email TEXT; ALTER TABLE users ADD COLUMN updated_at TEXT; INSERT INTO users(id,display_name) VALUES(7,'原名'); INSERT INTO files(id,user_id,bucket,object_key) VALUES(1,7,'FILES','profile.png')"
		);
		const concurrent: Database = {
			prepare(query) {
				if (query.startsWith('UPDATE users SET display_name'))
					sqlite.exec('DELETE FROM files WHERE id=1');
				return database.prepare(query);
			}
		};
		await expect(
			updateUserProfile(concurrent, 7, {
				displayName: '新名',
				email: null,
				avatarFileId: 1,
				coverFileId: null
			})
		).rejects.toThrow('所选图片已失效');
		expect(sqlite.prepare('SELECT display_name,avatar_file_id FROM users').get()).toEqual({
			display_name: '原名',
			avatar_file_id: null
		});
	});
});
