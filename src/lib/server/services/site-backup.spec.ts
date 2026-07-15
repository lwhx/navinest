import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	exportSiteBackup,
	restoreSiteBackup,
	validateSiteBackup
} from '$lib/server/services/site-backup';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY,password_hash TEXT);CREATE TABLE categories(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,parent_id INTEGER,name TEXT,slug TEXT,icon TEXT,description TEXT,sort_order INTEGER,is_visible INTEGER,UNIQUE(type,slug));CREATE TABLE tags(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,name TEXT,slug TEXT,description TEXT,UNIQUE(type,slug));CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,category_id INTEGER,author_id INTEGER,title TEXT,slug TEXT,summary TEXT,content TEXT,cover_file_id INTEGER,icon_file_id INTEGER,status TEXT,visibility TEXT,sort_order INTEGER,is_featured INTEGER,published_at TEXT,UNIQUE(type,slug));CREATE TABLE favorites(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),item_id INTEGER REFERENCES items(id) ON DELETE CASCADE);CREATE TABLE item_meta(item_id INTEGER,meta_key TEXT,meta_value TEXT,UNIQUE(item_id,meta_key));CREATE TABLE item_tags(item_id INTEGER,tag_id INTEGER,PRIMARY KEY(item_id,tag_id));CREATE TABLE home_modules(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,title TEXT,config_json TEXT,sort_order INTEGER,is_enabled INTEGER);CREATE TABLE search_engines(id INTEGER PRIMARY KEY AUTOINCREMENT,group_key TEXT,name TEXT,key TEXT UNIQUE,url_template TEXT,placeholder TEXT,sort_order INTEGER,is_enabled INTEGER);CREATE TABLE hot_sources(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,type TEXT,url TEXT,headers_json TEXT,parser_json TEXT,cache_ttl INTEGER,is_enabled INTEGER,last_fetch_at TEXT,slug TEXT UNIQUE,description TEXT DEFAULT '',icon TEXT DEFAULT '热',accent_color TEXT DEFAULT '#e5484d',surface_color TEXT DEFAULT '#fff7f7',display_limit INTEGER DEFAULT 20,layout TEXT DEFAULT 'list',sort_order INTEGER DEFAULT 0,show_description INTEGER DEFAULT 0,last_error TEXT,last_success_at TEXT);CREATE TABLE settings(key TEXT PRIMARY KEY,value_json TEXT);INSERT INTO users VALUES(1,'SECRET');INSERT INTO categories(type,name,slug,sort_order,is_visible)VALUES('site','Dev','dev',1,1);INSERT INTO tags(type,name,slug)VALUES('site','Code','code');INSERT INTO items(type,category_id,author_id,title,slug,status,visibility,sort_order,is_featured)VALUES('site',1,1,'GitHub','github','published','public',1,0);INSERT INTO favorites VALUES(1,1,1);INSERT INTO item_meta VALUES(1,'site_url','https://github.com');INSERT INTO item_tags VALUES(1,1);INSERT INTO settings VALUES('theme','{"mode":"dark"}');`
	);
	const db: Database & { batch(s: DatabaseStatement[]): Promise<unknown> } = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const st: DatabaseStatement = {
				bind(...next) {
					values = next;
					return st;
				},
				async all<T>() {
					return {
						results: sqlite
							.prepare(query)
							.all(...values.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v))) as T[]
					};
				}
			};
			return st;
		},
		async batch(statements) {
			sqlite.exec('BEGIN');
			try {
				for (const s of statements) await s.all();
				sqlite.exec('COMMIT');
			} catch (e) {
				sqlite.exec('ROLLBACK');
				throw e;
			}
		}
	};
	return { sqlite, db };
}
afterEach(() => connections.splice(0).forEach((x) => x.close()));
describe('site backup', () => {
	it('exports portable site data without users or secrets', async () => {
		const { db } = fixture();
		const backup = await exportSiteBackup(db, new Date('2026-07-13T00:00:00Z'));
		expect(backup).toMatchObject({
			format: 'navinest-backup',
			version: 1,
			categories: [{ type: 'site', slug: 'dev' }],
			items: [
				{
					type: 'site',
					slug: 'github',
					category: { type: 'site', slug: 'dev' },
					tags: [{ type: 'site', slug: 'code' }],
					meta: { site_url: 'https://github.com' }
				}
			],
			settings: { theme: { mode: 'dark' } }
		});
		expect(JSON.stringify(backup)).not.toContain('SECRET');
		expect(JSON.stringify(backup)).not.toContain('password_hash');
	});
	it('rejects invalid references before restore', () => {
		expect(
			validateSiteBackup({
				format: 'navinest-backup',
				version: 1,
				categories: [],
				tags: [],
				items: [
					{
						type: 'site',
						slug: 'x',
						title: 'X',
						category: { type: 'site', slug: 'missing' },
						tags: [],
						meta: {}
					}
				],
				homeModules: [],
				searchEngines: [],
				hotSources: [],
				settings: {}
			})
		).toMatchObject({ valid: false });
	});
	it('rejects duplicate natural keys and malformed records', () => {
		const result = validateSiteBackup({
			format: 'navinest-backup',
			version: 1,
			categories: [
				{ type: 'site', slug: 'same', name: 'A' },
				{ type: 'site', slug: 'same', name: 'B' }
			],
			tags: [],
			items: [],
			homeModules: [],
			searchEngines: [],
			hotSources: [{ name: 'Bad', type: 'rss', url: 'http://127.0.0.1/feed' }],
			settings: {}
		});
		expect(result).toMatchObject({ valid: false });
		if (!result.valid) expect(result.errors.join(' ')).toMatch(/重复|公网/);
	});
	it('atomically replaces site data while preserving users', async () => {
		const { db, sqlite } = fixture();
		const backup = await exportSiteBackup(db);
		backup.items[0].title = 'Restored GitHub';
		backup.settings.theme = { mode: 'light' };
		await restoreSiteBackup(db, backup);
		expect(sqlite.prepare("SELECT title FROM items WHERE slug='github'").get()).toMatchObject({
			title: 'Restored GitHub'
		});
		expect(sqlite.prepare("SELECT value_json FROM settings WHERE key='theme'").get()).toMatchObject(
			{ value_json: '{"mode":"light"}' }
		);
		expect(sqlite.prepare('SELECT password_hash FROM users WHERE id=1').get()).toMatchObject({
			password_hash: 'SECRET'
		});
		expect(sqlite.prepare('SELECT COUNT(*) count FROM favorites').get()).toMatchObject({
			count: 1
		});
	});
});
