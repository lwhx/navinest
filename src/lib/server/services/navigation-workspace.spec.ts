import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { listCustomNavigation } from './custom-navigation';
import {
	prepareNavigationMutation,
	commitNavigationMutation,
	cancelNavigationMutation,
	navigationReceipt
} from './navigation-workspace';
import type { NavigationMutation } from '$lib/custom-navigation-workspace';
const connections: DatabaseSync[] = [];
function fixture(count = 6) {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		'PRAGMA foreign_keys=ON;' +
			readdirSync('migrations')
				.filter((n) => /^\d{4}_.*\.sql$/.test(n))
				.sort()
				.map((n) => readFileSync('migrations/' + n, 'utf8'))
				.join('\n')
	);
	sqlite.exec(
		"INSERT INTO users(id,username,display_name)VALUES(7,'owner','本人'),(8,'other','他人');INSERT INTO custom_categories(id,user_id,name)VALUES(1,7,'工作'),(2,7,'生活'),(3,8,'外部');"
	);
	const insert = sqlite.prepare(
		'INSERT INTO custom_links(id,user_id,category_id,title,url,sort_order,status)VALUES(?,7,1,?,?,?,?)'
	);
	for (let i = 1; i <= count; i++)
		insert.run(i, '链接' + i, 'https://example.com/' + i, 0, i % 2 ? 'active' : 'inactive');
	sqlite.exec(
		"INSERT INTO custom_links(id,user_id,category_id,title,url)VALUES(90001,8,3,'他人链接','https://other.example/')"
	);
	let before: (() => void) | undefined,
		lose = false;
	const calls: string[] = [];
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
			before?.();
			sqlite.exec('BEGIN');
			try {
				for (const st of statements) await st.all();
				sqlite.exec('COMMIT');
			} catch (e) {
				sqlite.exec('ROLLBACK');
				throw e;
			}
			if (lose) throw new Error('lost response');
		}
	};
	return {
		db,
		sqlite,
		calls,
		before(fn: () => void) {
			before = fn;
		},
		lose() {
			lose = true;
		}
	};
}
afterEach(() => connections.splice(0).forEach((c) => c.close()));
async function packet(
	db: Database,
	mutation: NavigationMutation,
	extra: Record<string, unknown> = {}
) {
	const version = (await listCustomNavigation(db, 7)).version;
	const input = { mutation, version, ...extra };
	const { plan } = await prepareNavigationMutation(db, 7, input);
	return {
		...input,
		previewAt: plan.generatedAt,
		digest: plan.digest,
		runId: crypto.randomUUID(),
		confirmed: true
	};
}
const move: NavigationMutation = {
	kind: 'link-bulk',
	ids: [1, 4, 6],
	change: 'move',
	categoryId: 2
};
describe('personal navigation workspace mutations', () => {
	it('previews the complete explicit selection without writes and then moves only owned selections', async () => {
		const { db, sqlite } = fixture();
		const p = await packet(db, move);
		expect(sqlite.prepare('SELECT COUNT(*) n FROM settings').get()).toEqual({ n: 0 });
		expect((await prepareNavigationMutation(db, 7, p)).plan.items.map((l) => l.id)).toEqual([
			1, 4, 6
		]);
		await commitNavigationMutation(db, 7, p);
		expect(
			sqlite.prepare('SELECT id FROM custom_links WHERE category_id=2 ORDER BY id').all()
		).toEqual([{ id: 1 }, { id: 4 }, { id: 6 }]);
		expect(sqlite.prepare('SELECT category_id FROM custom_links WHERE id=90001').get()).toEqual({
			category_id: 3
		});
	});
	it('rejects foreign, duplicate, empty, over-limit and malformed selections before writes', async () => {
		const { db } = fixture();
		for (const ids of [
			[90001],
			[1, 1],
			[],
			Array.from({ length: 501 }, (_, i) => i + 1),
			[NaN],
			[0]
		])
			await expect(packet(db, { kind: 'link-delete', ids })).rejects.toThrow();
		await expect(packet(db, { ...move, categoryId: 3 })).rejects.toThrow('不属于');
	});
	it('preserves all link fields except the requested status and supports unclassified bulk moves', async () => {
		const { db, sqlite } = fixture();
		const before = sqlite
			.prepare('SELECT title,url,summary,sort_order FROM custom_links WHERE id=1')
			.get();
		await commitNavigationMutation(
			db,
			7,
			await packet(db, { kind: 'link-bulk', ids: [1, 2], change: 'inactive' })
		);
		expect(sqlite.prepare('SELECT status FROM custom_links WHERE id=1').get()).toEqual({
			status: 'inactive'
		});
		expect(
			sqlite.prepare('SELECT title,url,summary,sort_order FROM custom_links WHERE id=1').get()
		).toEqual(before);
		await commitNavigationMutation(
			db,
			7,
			await packet(db, { kind: 'link-bulk', ids: [1], change: 'move', categoryId: null })
		);
		expect(sqlite.prepare('SELECT category_id FROM custom_links WHERE id=1').get()).toEqual({
			category_id: null
		});
	});
	it('deletes selected links and preserves all others; category deletion keeps its links unclassified', async () => {
		const { db, sqlite } = fixture();
		await commitNavigationMutation(db, 7, await packet(db, { kind: 'link-delete', ids: [2, 4] }));
		expect(sqlite.prepare('SELECT id FROM custom_links WHERE user_id=7 ORDER BY id').all()).toEqual(
			[{ id: 1 }, { id: 3 }, { id: 5 }, { id: 6 }]
		);
		const p = await packet(db, { kind: 'category-delete', id: 1 });
		expect((await prepareNavigationMutation(db, 7, p)).plan.detail).toContain('4 条链接保留');
		await commitNavigationMutation(db, 7, p);
		expect(
			sqlite
				.prepare('SELECT COUNT(*) n FROM custom_links WHERE user_id=7 AND category_id IS NULL')
				.get()
		).toEqual({ n: 4 });
	});
	it('creates and edits with URL validation, category ownership and complete metadata preservation', async () => {
		const { db, sqlite } = fixture();
		const save: NavigationMutation = {
			kind: 'link-save',
			id: 1,
			data: {
				title: '新标题',
				url: 'https://example.org/new',
				categoryId: 2,
				summary: '摘要',
				sortOrder: 42,
				status: 'inactive'
			}
		};
		await commitNavigationMutation(db, 7, await packet(db, save));
		expect(
			sqlite
				.prepare(
					'SELECT title,url,category_id,summary,sort_order,status FROM custom_links WHERE id=1'
				)
				.get()
		).toEqual({
			title: '新标题',
			url: 'https://example.org/new',
			category_id: 2,
			summary: '摘要',
			sort_order: 42,
			status: 'inactive'
		});
		await expect(
			packet(db, { ...save, data: { ...save.data, url: 'javascript:alert(1)' } })
		).rejects.toThrow();
		await expect(packet(db, { ...save, data: { ...save.data, sortOrder: 1.2 } })).rejects.toThrow();
		await commitNavigationMutation(
			db,
			7,
			await packet(db, {
				kind: 'category-save',
				id: null,
				data: { name: '新增', icon: 'star', sortOrder: 30 }
			})
		);
		expect(sqlite.prepare("SELECT icon FROM custom_categories WHERE name='新增'").get()).toEqual({
			icon: 'star'
		});
	});
	it('rejects changed editor baselines, changed operation contents and expired confirmations', async () => {
		const { db, sqlite } = fixture();
		const p = await packet(db, move);
		sqlite.exec("UPDATE custom_links SET title='另一处修改' WHERE id=2");
		await expect(commitNavigationMutation(db, 7, p)).rejects.toMatchObject({
			status: 409,
			uncertain: false
		});
		const q = await packet(db, move);
		await expect(
			commitNavigationMutation(db, 7, { ...q, mutation: { ...move, ids: [1] } })
		).rejects.toMatchObject({ status: 409 });
		const old = await packet(db, move, {
			previewAt: new Date(Date.now() - 16 * 60000).toISOString()
		});
		await expect(commitNavigationMutation(db, 7, old)).rejects.toThrow('过期');
	});
	it('guards against changes between preparation and the actual transaction and rolls back receipts', async () => {
		const f = fixture();
		const p = await packet(f.db, move);
		f.before(() => f.sqlite.exec("UPDATE custom_links SET title='并发' WHERE id=2"));
		await expect(commitNavigationMutation(f.db, 7, p)).rejects.toMatchObject({ uncertain: true });
		expect(
			f.sqlite.prepare('SELECT COUNT(*) n FROM custom_links WHERE category_id=2').get()
		).toEqual({ n: 0 });
		expect(await navigationReceipt(f.db, 7, p.runId)).toBeNull();
	});
	it('rolls back all writes if any selected-row update fails', async () => {
		const f = fixture();
		const p = await packet(f.db, move);
		f.sqlite.exec(
			"CREATE TRIGGER fail_update BEFORE UPDATE ON custom_links WHEN new.id=4 BEGIN SELECT RAISE(ABORT,'forced'); END;"
		);
		await expect(commitNavigationMutation(f.db, 7, p)).rejects.toMatchObject({ uncertain: true });
		expect(
			f.sqlite.prepare('SELECT COUNT(*) n FROM custom_links WHERE category_id=2').get()
		).toEqual({ n: 0 });
		expect(await navigationReceipt(f.db, 7, p.runId)).toBeNull();
	});
	it('returns the original receipt after response loss and prevents replayed creates', async () => {
		const f = fixture();
		const p = await packet(f.db, {
			kind: 'category-save',
			id: null,
			data: { name: '只新增一次', icon: null, sortOrder: 10 }
		});
		f.lose();
		const first = await commitNavigationMutation(f.db, 7, p);
		expect(await commitNavigationMutation(f.db, 7, p)).toEqual(first);
		expect(await navigationReceipt(f.db, 8, p.runId)).toBeNull();
		expect(
			f.sqlite.prepare("SELECT COUNT(*) n FROM custom_categories WHERE name='只新增一次'").get()
		).toEqual({ n: 1 });
		expect(JSON.stringify(await navigationReceipt(f.db, 7, p.runId))).not.toContain('只新增一次');
	});
	it('cancels unstarted operations, blocks late commits and never deletes completed results', async () => {
		const { db, sqlite } = fixture();
		const p = await packet(db, move);
		await cancelNavigationMutation(db, 7, p);
		expect((await commitNavigationMutation(db, 7, p)).status).toBe('cancelled');
		expect(sqlite.prepare('SELECT COUNT(*) n FROM custom_links WHERE category_id=2').get()).toEqual(
			{ n: 0 }
		);
		const q = await packet(db, move);
		await commitNavigationMutation(db, 7, q);
		expect((await cancelNavigationMutation(db, 7, q)).status).toBe('completed');
	});
	it('requires an atomic database and explicit confirmation', async () => {
		const { db } = fixture();
		const p = await packet(db, move);
		await expect(commitNavigationMutation(db, 7, { ...p, confirmed: false })).rejects.toMatchObject(
			{ status: 428 }
		);
		await expect(commitNavigationMutation({ prepare: db.prepare }, 7, p)).rejects.toThrow(
			'整批提交'
		);
	});
	it('reorders more than 500 links atomically, respects category peers and preserves foreign ordering', async () => {
		const { db, sqlite, calls } = fixture(601);
		sqlite.exec('UPDATE custom_links SET category_id=2 WHERE id=600');
		const p = await packet(db, { kind: 'move', resource: 'link', id: 601, direction: -1 });
		await commitNavigationMutation(db, 7, p);
		const ids = (await listCustomNavigation(db, 7)).links.map((l) => l.id);
		expect(ids.slice(-4)).toEqual([598, 601, 600, 599]);
		expect(sqlite.prepare('SELECT sort_order FROM custom_links WHERE id=90001').get()).toEqual({
			sort_order: 0
		});
		expect(calls.length).toBeLessThan(25);
	});
	it('writes only the two neighbors when sorting a large collection with unique order values', async () => {
		const { db, sqlite } = fixture(601);
		sqlite.exec(
			'UPDATE custom_links SET sort_order=id*10; CREATE TABLE written_ids(id INTEGER); CREATE TRIGGER track_navigation_update AFTER UPDATE ON custom_links BEGIN INSERT INTO written_ids VALUES(new.id); END;'
		);
		await commitNavigationMutation(
			db,
			7,
			await packet(db, { kind: 'move', resource: 'link', id: 601, direction: -1 })
		);
		expect(sqlite.prepare('SELECT id FROM written_ids ORDER BY id').all()).toEqual([
			{ id: 600 },
			{ id: 601 }
		]);
		expect((await listCustomNavigation(db, 7)).links.slice(-3).map((l) => l.id)).toEqual([
			599, 601, 600
		]);
	});
});
