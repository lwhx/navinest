import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	exportSiteBackup,
	restoreSiteBackup,
	previewSiteBackup,
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
	it('excludes live link diagnostics from backups and guards, preserves them on restore and rejects injected runtime keys', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(`INSERT INTO settings VALUES('admin:link-check:item:1','{"status":"gone"}');`);
		const backup = await exportSiteBackup(db);
		expect(Object.keys(backup.settings)).toEqual(['theme']);
		backup.settings.theme = { mode: 'light' };
		const preview = await previewSiteBackup(db, backup);
		sqlite.exec(`INSERT INTO settings VALUES('admin:link-check:lease','{"token":"current"}');`);
		await restoreSiteBackup(db, backup, preview);
		expect(
			sqlite
				.prepare("SELECT COUNT(*) count FROM settings WHERE key GLOB 'admin:link-check:*'")
				.get()
		).toEqual({ count: 2 });
		expect(
			validateSiteBackup({
				...backup,
				settings: { ...backup.settings, 'admin:link-check:lease': { token: 'injected' } }
			})
		).toMatchObject({ valid: false });
	});
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
	it.each(['user:bookmark-import:', 'user:navigation:'])(
		'excludes private receipts in %s and preserves them on restore',
		async (prefix) => {
			const { db, sqlite } = fixture();
			sqlite.exec(`INSERT INTO settings VALUES('${prefix}7:run','{"status":"completed"}');`);
			const backup = await exportSiteBackup(db);
			expect(Object.keys(backup.settings)).toEqual(['theme']);
			backup.settings.theme = { mode: 'light' };
			const preview = await previewSiteBackup(db, backup);
			sqlite.exec(`INSERT INTO settings VALUES('${prefix}8:run','{"status":"cancelled"}');`);
			await restoreSiteBackup(db, backup, preview);
			expect(
				sqlite.prepare(`SELECT COUNT(*) n FROM settings WHERE key GLOB '${prefix}*'`).get()
			).toEqual({ n: 2 });
			expect(
				validateSiteBackup({
					...backup,
					settings: { ...backup.settings, [prefix + '7:run']: { status: 'cancelled' } }
				})
			).toMatchObject({ valid: false });
		}
	);
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

describe('reviewed backup restoration', () => {
	it('returns exact changes without modifying data or exposing configuration values', async () => {
		const { db, sqlite } = fixture(),
			backup = await exportSiteBackup(db);
		backup.items[0].title = '修改后';
		backup.settings.theme = { secret: '不得在预览返回的配置值' };
		backup.tags = [];
		backup.items[0].tags = [];
		backup.categories.push({
			...backup.categories[0],
			slug: 'new',
			name: '新增分类',
			parent: { type: 'site', slug: 'dev' }
		});
		sqlite.exec(
			"INSERT INTO items(type,title,slug,status,visibility) VALUES('site','备份之外','outside','published','private')"
		);
		const before = sqlite.prepare('SELECT * FROM items').all(),
			preview = await previewSiteBackup(db, backup);
		expect(sqlite.prepare('SELECT * FROM items').all()).toEqual(before);
		expect(preview.groups.find((g) => g.key === 'items')?.counts).toMatchObject({
			updated: 1,
			preserved: 1
		});
		expect(preview.groups.find((g) => g.key === 'tags')?.counts).toMatchObject({ preserved: 1 });
		expect(preview.groups.find((g) => g.key === 'settings')?.counts.updated).toBe(1);
		expect(
			preview.changes.find((r) => r.group === 'items' && r.action === 'updated')?.fields
		).toEqual(['标题', '标签关系']);
		expect(JSON.stringify(preview)).not.toContain('不得在预览返回的配置值');
		expect(preview.backupDigest).toMatch(/^[a-f0-9]{64}$/);
	});
	it('rejects null records, wrong field types, missing refs, cycles, cross-type refs and duplicate hot slugs without throwing', async () => {
		const { db } = fixture(),
			original = await exportSiteBackup(db);
		const cases: Array<(b: typeof original) => void> = [
			(b) => b.categories.push(null as never),
			(b) => b.items.push(null as never),
			(b) => {
				b.items[0].tags = {} as never;
			},
			(b) => {
				b.categories[0].parent = { type: 'site', slug: 'dev' };
			},
			(b) => {
				b.categories.push({ ...b.categories[0], type: 'post', slug: 'post' });
				b.items[0].category = { type: 'post', slug: 'post' };
			},
			(b) => {
				b.items[0].meta.bad = {} as never;
			},
			(b) => {
				b.categories[0].isVisible = 1 as never;
			},
			(b) => {
				b.hotSources = [{ name: '坏来源', type: 'rss', url: 'http://127.0.0.1/feed' } as never];
			}
		];
		for (const change of cases) {
			const backup = structuredClone(original);
			change(backup);
			expect(() => validateSiteBackup(backup)).not.toThrow();
			expect(validateSiteBackup(backup)).toMatchObject({ valid: false });
		}
	});
	it('recognizes semantic no-ops, accepts HTML sources, and does not rebuild identical groups', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			`INSERT INTO home_modules(type,title,config_json,sort_order,is_enabled) VALUES('search','搜索','{"x":1,"y":2}',0,1)`
		);
		const backup = await exportSiteBackup(db),
			id = sqlite.prepare('SELECT id FROM home_modules').get();
		backup.homeModules[0].config = { y: 2, x: 1 };
		expect((await previewSiteBackup(db, backup)).hasChanges).toBe(false);
		expect(await restoreSiteBackup(db, backup)).toMatchObject({ unchanged: true, changed: 0 });
		expect(sqlite.prepare('SELECT id FROM home_modules').get()).toEqual(id);
		backup.hotSources = [
			{
				name: 'HTML 热榜',
				type: 'html',
				url: 'https://example.com/hot',
				headers: {},
				parser: { itemSelector: '.item' },
				cacheTtl: 900,
				isEnabled: true,
				slug: 'html-hot'
			}
		];
		expect(validateSiteBackup(backup).valid).toBe(true);
		await restoreSiteBackup(db, backup);
		expect(sqlite.prepare('SELECT type FROM hot_sources').get()).toMatchObject({ type: 'html' });
	});
	it('resets a restored root parent, keeps unlisted content, IDs, owners, media and private relations', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO categories(id,type,name,slug,sort_order,is_visible) VALUES(2,'site','Parent','parent',0,1); UPDATE categories SET parent_id=2 WHERE id=1; UPDATE items SET icon_file_id=123,cover_file_id=456 WHERE id=1"
		);
		const backup = await exportSiteBackup(db);
		backup.categories[0].parent = null;
		backup.items[0].title = '更新';
		const proof = await previewSiteBackup(db, backup);
		await restoreSiteBackup(db, backup, proof);
		expect(sqlite.prepare('SELECT parent_id FROM categories WHERE id=1').get()).toMatchObject({
			parent_id: null
		});
		expect(
			sqlite.prepare('SELECT id,author_id,icon_file_id,cover_file_id FROM items WHERE id=1').get()
		).toEqual({ id: 1, author_id: 1, icon_file_id: 123, cover_file_id: 456 });
		expect(sqlite.prepare('SELECT COUNT(*) n FROM favorites').get()).toEqual({ n: 1 });
		await expect(restoreSiteBackup(db, backup, proof)).rejects.toMatchObject({ status: 409 });
	});
	it('rejects a changed file or stale site preview before writes', async () => {
		const { db, sqlite } = fixture(),
			backup = await exportSiteBackup(db);
		backup.items[0].title = '恢复值';
		const proof = await previewSiteBackup(db, backup),
			changed = structuredClone(backup);
		changed.items[0].title = '其他文件';
		await expect(restoreSiteBackup(db, changed, proof)).rejects.toMatchObject({ status: 409 });
		sqlite.exec("UPDATE items SET title='管理员刚刚编辑' WHERE id=1");
		await expect(restoreSiteBackup(db, backup, proof)).rejects.toMatchObject({ status: 409 });
		expect(sqlite.prepare('SELECT title FROM items WHERE id=1').get()).toEqual({
			title: '管理员刚刚编辑'
		});
	});
	it('atomically rejects state changes between preflight and the write batch', async () => {
		const { db, sqlite } = fixture(),
			backup = await exportSiteBackup(db);
		backup.items[0].title = '不能覆盖并发编辑';
		const proof = await previewSiteBackup(db, backup);
		const race = {
			prepare: db.prepare.bind(db),
			async batch(statements: DatabaseStatement[]) {
				sqlite.exec("UPDATE categories SET name='晚到的修改' WHERE id=1");
				return db.batch(statements);
			}
		};
		await expect(restoreSiteBackup(race, backup, proof)).rejects.toMatchObject({ status: 409 });
		expect(sqlite.prepare('SELECT title FROM items WHERE id=1').get()).toEqual({ title: 'GitHub' });
		expect(sqlite.prepare('SELECT name FROM categories WHERE id=1').get()).toEqual({
			name: '晚到的修改'
		});
	});
	it('rolls the whole restore back if a later write fails, and keeps an ambiguous commit protected from repeat', async () => {
		const { db, sqlite } = fixture(),
			backup = await exportSiteBackup(db);
		backup.categories[0].name = '应回滚';
		backup.items[0].title = '写入故障';
		sqlite.exec(
			"CREATE TRIGGER injected_failure BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT,'injected write failure'); END;"
		);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await expect(restoreSiteBackup(db, backup)).rejects.toMatchObject({ uncertain: true });
			expect(sqlite.prepare('SELECT name FROM categories WHERE id=1').get()).toEqual({
				name: 'Dev'
			});
			sqlite.exec('DROP TRIGGER injected_failure');
			const proof = await previewSiteBackup(db, backup),
				lost = {
					prepare: db.prepare.bind(db),
					async batch(s: DatabaseStatement[]) {
						await db.batch(s);
						throw new Error('response lost');
					}
				};
			await expect(restoreSiteBackup(lost, backup, proof)).rejects.toMatchObject({
				uncertain: true
			});
			expect(sqlite.prepare('SELECT title FROM items WHERE id=1').get()).toEqual({
				title: '写入故障'
			});
			await expect(restoreSiteBackup(db, backup, proof)).rejects.toMatchObject({ status: 409 });
			expect((await previewSiteBackup(db, backup)).hasChanges).toBe(false);
		} finally {
			log.mockRestore();
		}
	});
	it('restores hundreds of records within a bounded statement and binding budget', async () => {
		const { db, sqlite } = fixture(),
			backup = await exportSiteBackup(db);
		for (let n = 0; n < 225; n++)
			backup.items.push({ ...backup.items[0], slug: 'bulk-' + n, title: '批量恢复 ' + n });
		let statements = 0;
		const bounded = {
			prepare: db.prepare.bind(db),
			async batch(s: DatabaseStatement[]) {
				statements = s.length;
				return db.batch(s);
			}
		};
		await restoreSiteBackup(bounded, backup);
		expect(statements).toBeLessThanOrEqual(38);
		expect(sqlite.prepare('SELECT COUNT(*) n FROM items').get()).toEqual({ n: 226 });
	});
});

it('restores the order of replacement groups even when their field values are identical', async () => {
	const { db, sqlite } = fixture();
	sqlite.exec(
		"INSERT INTO search_engines(group_key,name,key,url_template,sort_order,is_enabled) VALUES('global','First','first','https://example.com/?q={query}',0,1),('global','Second','second','https://example.com/?q={query}',0,1)"
	);
	const backup = await exportSiteBackup(db);
	backup.searchEngines.reverse();
	const preview = await previewSiteBackup(db, backup);
	expect(preview.groups.find((g) => g.key === 'searchEngines')?.counts.updated).toBe(2);
	expect(
		preview.changes
			.filter((c) => c.group === 'searchEngines')
			.every((c) => c.fields.includes('组内顺序'))
	).toBe(true);
	await restoreSiteBackup(db, backup, preview);
	expect((await exportSiteBackup(db)).searchEngines.map((s) => s.key)).toEqual(['second', 'first']);
	expect((await previewSiteBackup(db, backup)).hasChanges).toBe(false);
});

it('round-trips the built-in site search template', async () => {
	const { db, sqlite } = fixture();
	sqlite.exec(
		"INSERT INTO search_engines(group_key,name,key,url_template,sort_order,is_enabled) VALUES('site','站内搜索','site','/search?q={query}',0,1)"
	);
	const backup = await exportSiteBackup(db);
	expect(validateSiteBackup(backup).valid).toBe(true);
	expect((await previewSiteBackup(db, backup)).hasChanges).toBe(false);
});
