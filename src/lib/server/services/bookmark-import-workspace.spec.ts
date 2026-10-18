import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	prepareBookmarkImport,
	commitBookmarkImport,
	bookmarkImportReceipt,
	cancelBookmarkImport
} from './bookmark-import-workspace';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`PRAGMA foreign_keys=ON;CREATE TABLE custom_categories(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,parent_id INTEGER,name TEXT,icon TEXT,sort_order INTEGER DEFAULT 0);CREATE TABLE custom_links(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,category_id INTEGER REFERENCES custom_categories(id),title TEXT,url TEXT,icon_url TEXT,summary TEXT,sort_order INTEGER DEFAULT 0,status TEXT);CREATE TABLE settings(key TEXT PRIMARY KEY,value_json TEXT);`
	);
	const calls: string[] = [];
	let beforeBatch: (() => void) | undefined;
	let loseResponse = false;
	const db: Database & { batch(s: DatabaseStatement[]): Promise<void> } = {
		prepare(query) {
			calls.push(query);
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
			beforeBatch?.();
			sqlite.exec('BEGIN');
			try {
				for (const s of statements) await s.all();
				sqlite.exec('COMMIT');
			} catch (e) {
				sqlite.exec('ROLLBACK');
				throw e;
			}
			if (loseResponse) throw new Error('response lost');
		}
	};
	return {
		db,
		sqlite,
		calls,
		setBefore(fn: () => void) {
			beforeBatch = fn;
		},
		lose() {
			loseResponse = true;
		}
	};
}
afterEach(() => connections.splice(0).forEach((c) => c.close()));
const link = (url: string, title = '测试书签') => `<A HREF="${url}">${title}</A>`;
const file = (body: string) => '<DL><H3>工作</H3><DL>' + body + '</DL></DL>';
const run = () => crypto.randomUUID();
async function packet(db: Database, html: string, extra: Record<string, unknown> = {}) {
	const { preview } = await prepareBookmarkImport(db, 7, { html, ...extra });
	return {
		html,
		selected: preview.rows.filter((r) => r.selected).map((r) => r.id),
		mappings: preview.mappings,
		previewAt: preview.generatedAt,
		digest: preview.digest,
		runId: run(),
		confirmed: true
	};
}
describe('reviewed atomic bookmark imports', () => {
	it('previews complete duplicate and invalid classifications without writing', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO custom_links(user_id,title,url,status)VALUES(7,'已有','https://example.com/','inactive'),(8,'另一用户','https://other.com/','active')"
		);
		const { preview } = await prepareBookmarkImport(db, 7, {
			html: file(
				link('https://EXAMPLE.com') +
					link('https://new.com/') +
					link('https://new.com/') +
					link('javascript:x') +
					link('https://other.com/')
			)
		});
		expect(preview.rows.map((r) => r.status)).toEqual([
			'existing',
			'new',
			'duplicate',
			'invalid',
			'new'
		]);
		expect(preview.selected).toBe(2);
		expect(preview.newCategories).toEqual(['工作']);
		expect(sqlite.prepare('SELECT COUNT(*) n FROM settings').get()).toEqual({ n: 0 });
		expect(sqlite.prepare('SELECT COUNT(*) n FROM custom_categories').get()).toEqual({ n: 0 });
	});
	it('imports only selected rows, maps owned categories and creates one shared new category', async () => {
		const { db, sqlite, calls } = fixture();
		sqlite.exec(
			"INSERT INTO custom_categories(user_id,name,sort_order) VALUES(7,'已有分类',30),(8,'别人分类',0)"
		);
		const html =
			file(link('https://example.com/a') + link('https://example.com/b')) +
			'<DL><H3>其他</H3><DL>' +
			link('https://example.org/') +
			'</DL></DL>';
		const input = await packet(db, html, {
			selected: [1, 2],
			mappings: [
				{ folder: '工作', target: 'existing', categoryId: 1 },
				{ folder: '其他', target: 'new', name: '新分类' }
			]
		});
		const result = await commitBookmarkImport(db, 7, input);
		expect(result).toMatchObject({ status: 'completed', imported: 2, categories: 1 });
		expect(
			sqlite.prepare('SELECT category_id,url,sort_order FROM custom_links ORDER BY id').all()
		).toEqual([
			{ category_id: 1, url: 'https://example.com/b', sort_order: 10 },
			{ category_id: 3, url: 'https://example.org/', sort_order: 20 }
		]);
		expect(calls.length).toBeLessThan(25);
		expect(JSON.stringify(await bookmarkImportReceipt(db, 7, input.runId))).not.toContain(
			'example.com'
		);
	});
	it('keeps top-level links uncategorised and does not create folders for deselected entries', async () => {
		const { db, sqlite } = fixture();
		const html = link('https://example.com/') + file(link('https://example.org/'));
		await commitBookmarkImport(db, 7, await packet(db, html, { selected: [0] }));
		expect(sqlite.prepare('SELECT category_id FROM custom_links').get()).toEqual({
			category_id: null
		});
		expect(sqlite.prepare('SELECT COUNT(*) n FROM custom_categories').get()).toEqual({ n: 0 });
	});
	it('lets a later row replace an initial 500-row selection while exposing all entries', async () => {
		const { db } = fixture();
		const html = file(
			Array.from({ length: 501 }, (_, i) => link('https://example.com/' + i)).join('')
		);
		const { preview } = await prepareBookmarkImport(db, 7, { html });
		expect(preview.rows).toHaveLength(501);
		expect(preview.selected).toBe(500);
		expect(preview.rows[500].status).toBe('limited');
		const second = await prepareBookmarkImport(db, 7, { html, selected: [500] });
		expect(second.preview.rows[500]).toMatchObject({ status: 'new', selected: true });
		await expect(
			prepareBookmarkImport(db, 7, { html, selected: Array.from({ length: 501 }, (_, i) => i) })
		).rejects.toThrow('500');
	});
	it('rejects duplicate, invalid and unknown row selections and foreign classification IDs', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec("INSERT INTO custom_categories(user_id,name) VALUES(8,'外部')");
		const html = file(
			link('https://example.com/') + link('https://example.com/') + link('javascript:x')
		);
		for (const selected of [[0, 0], [1], [2], [999], [-1]])
			await expect(prepareBookmarkImport(db, 7, { html, selected })).rejects.toThrow();
		await expect(
			prepareBookmarkImport(db, 7, {
				html,
				mappings: [{ folder: '工作', target: 'existing', categoryId: 1 }]
			})
		).rejects.toThrow('不属于');
	});
	it('reuses exact owned defaults but requires an explicit target for ambiguous category names', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec("INSERT INTO custom_categories(user_id,name)VALUES(7,'工作')");
		expect(
			(await prepareBookmarkImport(db, 7, { html: file(link('https://example.com')) })).preview
				.mappings[0]
		).toMatchObject({ target: 'existing', categoryId: 1 });
		sqlite.exec("INSERT INTO custom_categories(user_id,name)VALUES(7,'工作')");
		const unresolved = await packet(db, file(link('https://example.com')));
		expect(unresolved.mappings[0].target).toBe('choose');
		await expect(commitBookmarkImport(db, 7, unresolved)).rejects.toThrow('具体目标');
	});
	it('requires a current preview and confirmation; rejects altered files, mapping and expiration', async () => {
		const { db } = fixture(),
			html = file(link('https://example.com/'));
		const input = await packet(db, html);
		await expect(commitBookmarkImport(db, 7, { ...input, confirmed: false })).rejects.toMatchObject(
			{ status: 428 }
		);
		await expect(
			commitBookmarkImport(db, 7, { ...input, digest: undefined })
		).rejects.toMatchObject({ status: 428 });
		await expect(
			commitBookmarkImport(db, 7, { ...input, html: file(link('https://different.com/')) })
		).rejects.toMatchObject({ status: 409 });
		const expired = await packet(db, html, {
			previewAt: new Date(Date.now() - 16 * 60000).toISOString()
		});
		await expect(commitBookmarkImport(db, 7, expired)).rejects.toThrow('过期');
	});
	it('refuses a preview after existing links or categories change', async () => {
		const { db, sqlite } = fixture(),
			input = await packet(db, file(link('https://example.com/')));
		sqlite.exec(
			"INSERT INTO custom_links(user_id,title,url,status)VALUES(7,'新加入','https://elsewhere.com','active')"
		);
		await expect(commitBookmarkImport(db, 7, input)).rejects.toMatchObject({ status: 409 });
		expect(sqlite.prepare('SELECT COUNT(*) n FROM custom_links').get()).toEqual({ n: 1 });
	});
	it('guards changes between state reads and the actual batch and never creates a partial folder', async () => {
		const f = fixture(),
			input = await packet(f.db, file(link('https://example.com/')));
		f.setBefore(() =>
			f.sqlite.exec(
				"INSERT INTO custom_links(user_id,title,url,status)VALUES(7,'并发','https://example.com/','active')"
			)
		);
		await expect(commitBookmarkImport(f.db, 7, input)).rejects.toMatchObject({ uncertain: true });
		expect(f.sqlite.prepare('SELECT COUNT(*) n FROM custom_categories').get()).toEqual({ n: 0 });
		expect(f.sqlite.prepare('SELECT COUNT(*) n FROM custom_links').get()).toEqual({ n: 1 });
	});
	it('rolls back the complete batch when link insertion fails', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"CREATE TRIGGER fail_link BEFORE INSERT ON custom_links WHEN NEW.url LIKE '%/bad' BEGIN SELECT RAISE(ABORT,'fault'); END;"
		);
		const input = await packet(
			db,
			file(link('https://example.com/ok') + link('https://example.com/bad'))
		);
		await expect(commitBookmarkImport(db, 7, input)).rejects.toMatchObject({ uncertain: true });
		for (const table of ['custom_links', 'custom_categories', 'settings'])
			expect(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({ n: 0 });
	});
	it('records one completion atomically and returns it after lost responses or replay', async () => {
		const f = fixture(),
			input = await packet(f.db, file(link('https://example.com/')));
		f.lose();
		const first = await commitBookmarkImport(f.db, 7, input);
		const second = await commitBookmarkImport(f.db, 7, input);
		expect(second).toEqual(first);
		expect(f.sqlite.prepare('SELECT COUNT(*) n FROM custom_links').get()).toEqual({ n: 1 });
		expect(await bookmarkImportReceipt(f.db, 8, input.runId)).toBeNull();
	});
	it('cancels an unstarted batch, rejects a changed identity, and blocks late requests', async () => {
		const { db, sqlite } = fixture(),
			input = await packet(db, file(link('https://example.com/')));
		expect(await cancelBookmarkImport(db, 7, input.runId, input.digest)).toMatchObject({
			status: 'cancelled'
		});
		expect(await commitBookmarkImport(db, 7, input)).toMatchObject({
			status: 'cancelled',
			imported: 0
		});
		await expect(
			commitBookmarkImport(db, 7, { ...input, digest: 'a'.repeat(64) })
		).rejects.toMatchObject({ status: 409 });
		expect(sqlite.prepare('SELECT COUNT(*) n FROM custom_links').get()).toEqual({ n: 0 });
	});
	it('cancel after a successful commit returns completion and does not remove links', async () => {
		const { db, sqlite } = fixture(),
			input = await packet(db, file(link('https://example.com/')));
		await commitBookmarkImport(db, 7, input);
		expect(await cancelBookmarkImport(db, 7, input.runId, input.digest)).toMatchObject({
			status: 'completed',
			imported: 1
		});
		expect(sqlite.prepare('SELECT COUNT(*) n FROM custom_links').get()).toEqual({ n: 1 });
	});
	it('requires a real atomic batch implementation before any writes', async () => {
		const { db, sqlite } = fixture(),
			plain = { prepare: db.prepare },
			input = await packet(plain, file(link('https://example.com/')));
		await expect(commitBookmarkImport(plain, 7, input)).rejects.toThrow('整批提交');
		expect(sqlite.prepare('SELECT COUNT(*) n FROM settings').get()).toEqual({ n: 0 });
	});
	it('batches a full 500 links and folders within the Free-plan statement budget', async () => {
		const { db, sqlite, calls } = fixture();
		const html = Array.from(
			{ length: 500 },
			(_, i) => `<DL><H3>目录${i}</H3><DL>${link('https://example.com/' + i)}</DL></DL>`
		).join('');
		const input = await packet(db, html);
		calls.length = 0;
		expect(await commitBookmarkImport(db, 7, input)).toMatchObject({
			imported: 500,
			categories: 500
		});
		expect(calls.length).toBeLessThan(20);
		expect(sqlite.prepare('SELECT COUNT(*) n FROM custom_links').get()).toEqual({ n: 500 });
	});
});
