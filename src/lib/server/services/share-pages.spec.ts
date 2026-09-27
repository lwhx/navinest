import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	getShareSettings,
	loadPublicShare,
	saveShareSettings,
	SharePageError,
	validateShareSlug
} from '$lib/server/services/share-pages';

const connections: DatabaseSync[] = [];

function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
		CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE,display_name TEXT,role TEXT,status TEXT,share_slug TEXT,share_enabled INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
		CREATE UNIQUE INDEX idx_users_share_slug ON users(share_slug) WHERE share_slug IS NOT NULL;
		CREATE TABLE custom_categories(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,name TEXT,sort_order INTEGER DEFAULT 0);
		CREATE TABLE custom_links(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,category_id INTEGER,title TEXT,url TEXT,summary TEXT,sort_order INTEGER DEFAULT 0,status TEXT DEFAULT 'active');
		INSERT INTO users(id,username,display_name,role,status) VALUES(7,'blackice','黑冰','user','active'),(8,'other','别人','user','active'),(9,'gone','停用的人','user','disabled');
		INSERT INTO custom_categories(id,user_id,name,sort_order) VALUES(1,7,'工作',0),(2,7,'空的分类',1);
		INSERT INTO custom_links(user_id,category_id,title,url,summary,sort_order,status) VALUES
			(7,1,'GitHub','https://github.com','代码托管',0,'active'),
			(7,1,'内部草稿','https://example.com/draft','未启用',1,'inactive'),
			(7,NULL,'首页','https://example.com','',2,'active'),
			(8,1,'别人的链接','https://other.example.com',NULL,0,'active');
	`);
	const db: Database = {
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
	return { sqlite, db };
}
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('share slug validation', () => {
	it('normalises case and whitespace', () => {
		expect(validateShareSlug('  My-Links  ')).toBe('my-links');
		expect(validateShareSlug('abc123')).toBe('abc123');
	});

	it('rejects empty, malformed and reserved slugs', () => {
		expect(() => validateShareSlug('')).toThrow('请填写分享地址');
		expect(() => validateShareSlug('ab')).toThrow('3–30 位');
		expect(() => validateShareSlug('-leading')).toThrow('3–30 位');
		expect(() => validateShareSlug('with space')).toThrow('3–30 位');
		expect(() => validateShareSlug('a'.repeat(31))).toThrow('3–30 位');
		expect(() => validateShareSlug('admin')).toThrow('系统保留');
		expect(() => validateShareSlug('api')).toThrow('系统保留');
		expect(() => validateShareSlug('u')).toThrow('3–30 位');
	});
});

describe('share settings', () => {
	it('starts closed with no slug', async () => {
		const { db } = fixture();
		expect(await getShareSettings(db, 7)).toEqual({ slug: '', enabled: false });
	});

	it('saves a slug and toggles publishing', async () => {
		const { db, sqlite } = fixture();
		expect(await saveShareSettings(db, 7, { slug: 'my-links', enabled: true })).toEqual({
			slug: 'my-links',
			enabled: true
		});
		expect(sqlite.prepare('SELECT share_slug,share_enabled FROM users WHERE id=7').get()).toEqual({
			share_slug: 'my-links',
			share_enabled: 1
		});
		expect(await saveShareSettings(db, 7, { slug: '', enabled: false })).toEqual({
			slug: 'my-links',
			enabled: false
		});
		expect(await saveShareSettings(db, 7, { enabled: true })).toEqual({
			slug: 'my-links',
			enabled: true
		});
	});

	it('refuses slugs that another account already publishes', async () => {
		const { db } = fixture();
		await saveShareSettings(db, 8, { slug: 'taken', enabled: true });
		await expect(saveShareSettings(db, 7, { slug: 'taken', enabled: true })).rejects.toMatchObject({
			status: 409,
			field: 'slug'
		});
		await expect(saveShareSettings(db, 7, { slug: 'fresh', enabled: true })).resolves.toMatchObject(
			{
				slug: 'fresh'
			}
		);
	});

	it('surfaces typed errors for invalid slugs', async () => {
		const { db } = fixture();
		await expect(saveShareSettings(db, 7, { slug: 'admin', enabled: true })).rejects.toBeInstanceOf(
			SharePageError
		);
	});
});

describe('public share pages', () => {
	it('is hidden until it is both enabled and the owner stays active', async () => {
		const { db } = fixture();
		await saveShareSettings(db, 7, { slug: 'my-links', enabled: true });
		expect(await loadPublicShare(db, 'MY-LINKS')).not.toBeNull();
		await saveShareSettings(db, 7, { enabled: false });
		expect(await loadPublicShare(db, 'my-links')).toBeNull();
		await saveShareSettings(db, 9, { slug: 'gone-page', enabled: true });
		expect(await loadPublicShare(db, 'gone-page')).toBeNull();
		expect(await loadPublicShare(db, 'unknown')).toBeNull();
		expect(await loadPublicShare(db, '')).toBeNull();
	});

	it('only exposes active links and groups them per category', async () => {
		const { db } = fixture();
		await saveShareSettings(db, 7, { slug: 'my-links', enabled: true });
		const share = await loadPublicShare(db, 'my-links');
		expect(share?.owner).toEqual({ username: 'blackice', displayName: '黑冰' });
		expect(share?.total).toBe(2);
		expect(share?.groups).toEqual([
			{
				id: 1,
				name: '工作',
				links: [{ id: 1, title: 'GitHub', url: 'https://github.com', summary: '代码托管' }]
			},
			{
				id: null,
				name: null,
				links: [{ id: 3, title: '首页', url: 'https://example.com', summary: '' }]
			}
		]);
		expect(JSON.stringify(share)).not.toContain('内部草稿');
		expect(JSON.stringify(share)).not.toContain('别人的链接');
	});
});
