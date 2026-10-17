import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { searchSourcePreview } from '$lib/search-source';
import { listSearchEngines } from './search-engines';
import {
	searchSourceWorkspace,
	reorderSearchSource,
	setSearchSourceEnabled
} from './search-source-workspace';
const connections: DatabaseSync[] = [];
function fixture(count = 3) {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		'CREATE TABLE search_engines(id INTEGER PRIMARY KEY,group_key TEXT,name TEXT,key TEXT UNIQUE,url_template TEXT,placeholder TEXT,sort_order INTEGER,is_enabled INTEGER)'
	);
	const insert = sqlite.prepare('INSERT INTO search_engines VALUES(?,?,?,?,?,?,?,?)');
	for (let id = 1; id <= count; id++)
		insert.run(
			id,
			id % 2 ? 'general' : 'dev',
			'中文源 ' + String(id).padStart(3, '0'),
			'source-' + id,
			'https://example.com/search?q={query}',
			'提示 ' + id,
			10,
			1
		);
	const database: Database & { batch(s: DatabaseStatement[]): Promise<void> } = {
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
		},
		async batch(statements) {
			sqlite.exec('BEGIN');
			try {
				for (const statement of statements) await statement.all();
				sqlite.exec('COMMIT');
			} catch (error) {
				sqlite.exec('ROLLBACK');
				throw error;
			}
		}
	};
	return {
		database,
		sqlite,
		snapshot: () => sqlite.prepare('SELECT * FROM search_engines ORDER BY id').all()
	};
}
afterEach(() => connections.splice(0).forEach((db) => db.close()));
describe('search source previews and complete workspace', () => {
	it('encodes Chinese, spaces, ampersands, plus and fragments as one keyword without writes', () => {
		const { snapshot } = fixture(),
			before = snapshot(),
			query = '中文 & C++ / #?';
		const preview = searchSourcePreview('https://example.com/search?q={query}&mode=all', query);
		expect(preview).toMatchObject({ valid: true, internal: false, host: 'example.com' });
		if (!preview.valid) throw new Error('Invalid preview');
		expect(new URL(preview.target).searchParams.get('q')).toBe(query);
		expect(new URL(preview.target).hash).toBe('');
		expect(new URL(preview.target).searchParams.get('mode')).toBe('all');
		expect(snapshot()).toEqual(before);
	});
	it.each([
		'https://{query}.example.com/',
		'https://example.com/?q={query}&q2={query}',
		'https://example.com/?q={other}',
		'https://example.com/search',
		'//example.com/?q={query}',
		'javascript:alert({query})',
		'https://user:pass@example.com/?q={query}',
		'http://127.0.0.1/?q={query}',
		'/admin?q={query}'
	])('rejects unsupported or unsafe template %s', (template) => {
		expect(searchSourcePreview(template, 'word').valid).toBe(false);
	});
	it('supports the fixed onsite route and encoded path/fragment searches', () => {
		expect(searchSourcePreview('/search?q={query}', '  中文 /  ')).toMatchObject({
			valid: true,
			internal: true,
			target: '/search?q=%E4%B8%AD%E6%96%87%20%2F'
		});
		expect(searchSourcePreview('https://example.com/topics/{query}', 'a/b')).toMatchObject({
			valid: true,
			target: 'https://example.com/topics/a%2Fb'
		});
		expect(searchSourcePreview('https://example.com/#{query}', 'a#b')).toMatchObject({
			valid: true,
			target: 'https://example.com/#a%23b'
		});
		expect(searchSourcePreview('/search?q={query}', '   ').valid).toBe(false);
	});
	it('paginates all 225 matches, retains independent editor lookup and literal filters', async () => {
		const { database, sqlite } = fixture(225);
		const last = await searchSourceWorkspace(database, new URLSearchParams('page=999&edit=1'));
		expect(last).toMatchObject({ total: 225, page: 12, pages: 12, editing: { id: 1 } });
		expect(last.searchEngines).toHaveLength(5);
		expect(last.searchEngines.at(-1)?.id).toBe(225);
		sqlite.exec("UPDATE search_engines SET name='literal 100%_check' WHERE id=221");
		const filtered = await searchSourceWorkspace(
			database,
			new URLSearchParams('q=%25_&group=general')
		);
		expect(filtered.total).toBe(1);
		expect(filtered.searchEngines[0].id).toBe(221);
	});
	it('keeps invalid historical sources editable and excludes them from public search without changing data', async () => {
		const { database, sqlite, snapshot } = fixture();
		sqlite.exec("UPDATE search_engines SET url_template='javascript:alert({query})' WHERE id=1");
		const before = snapshot();
		expect((await listSearchEngines(database)).map((row) => row.id)).toEqual([2, 3]);
		const workspace = await searchSourceWorkspace(database, new URLSearchParams('status=invalid'));
		expect(workspace).toMatchObject({ total: 1, defaultEngine: { id: 2 } });
		expect(workspace.searchEngines[0]).toMatchObject({ id: 1, templateValid: false });
		expect(snapshot()).toEqual(before);
	});
});
describe('atomic search-source ordering and status', () => {
	it('moves a source across complete pages in two statements and preserves other fields', async () => {
		const { database, sqlite, snapshot } = fixture(225),
			before = snapshot(),
			batch = database.batch.bind(database);
		let statements = 0;
		database.batch = async (items) => {
			statements = items.length;
			await batch(items);
		};
		await reorderSearchSource(database, 225, 'first');
		expect(statements).toBe(2);
		expect((await listSearchEngines(database))[0].id).toBe(225);
		expect(sqlite.prepare('SELECT COUNT(DISTINCT sort_order) n FROM search_engines').get()).toEqual(
			{ n: 225 }
		);
		expect(snapshot().map((row) => ({ ...row, sort_order: 0 }))).toEqual(
			before.map((row) => ({ ...row, sort_order: 0 }))
		);
	});
	it.each(['order', 'enabled', 'template', 'insert'])(
		'rejects a late %s change before writing any planned order',
		async (change) => {
			const { database, sqlite, snapshot } = fixture(),
				batch = database.batch.bind(database);
			let changed: ReturnType<typeof snapshot>;
			database.batch = async (statements) => {
				sqlite.exec(
					change === 'order'
						? 'UPDATE search_engines SET sort_order=999 WHERE id=1'
						: change === 'enabled'
							? 'UPDATE search_engines SET is_enabled=0 WHERE id=3'
							: change === 'template'
								? "UPDATE search_engines SET url_template='https://example.com/new?q={query}' WHERE id=3"
								: "INSERT INTO search_engines VALUES(4,'dev','Fourth','fourth','/search?q={query}',NULL,0,1)"
				);
				changed = snapshot();
				await batch(statements);
			};
			await expect(reorderSearchSource(database, 3, 'first')).rejects.toMatchObject({
				status: 409
			});
			expect(snapshot()).toEqual(changed!);
		}
	);
	it('rolls back every rank if a later row update fails', async () => {
		const { database, sqlite, snapshot } = fixture(),
			before = snapshot();
		sqlite.exec(
			"CREATE TRIGGER reject_rank BEFORE UPDATE OF sort_order ON search_engines WHEN NEW.id=2 BEGIN SELECT RAISE(ABORT,'injected rank failure'); END"
		);
		await expect(reorderSearchSource(database, 3, 'up')).rejects.toThrow('injected');
		expect(snapshot()).toEqual(before);
	});
	it('rejects stale toggles and disabled/invalid defaults while keeping the existing default', async () => {
		const { database, sqlite } = fixture();
		await setSearchSourceEnabled(database, 1, true);
		await expect(setSearchSourceEnabled(database, 1, true)).rejects.toMatchObject({ status: 409 });
		await expect(reorderSearchSource(database, 1, 'first')).rejects.toMatchObject({ status: 409 });
		sqlite.exec("UPDATE search_engines SET url_template='broken' WHERE id=3");
		await expect(reorderSearchSource(database, 3, 'first')).rejects.toMatchObject({ status: 409 });
		expect((await searchSourceWorkspace(database, new URLSearchParams())).defaultEngine?.id).toBe(
			2
		);
		await setSearchSourceEnabled(database, 2, true);
		await setSearchSourceEnabled(database, 3, true);
		expect((await searchSourceWorkspace(database, new URLSearchParams())).defaultEngine).toBe(null);
	});
});
