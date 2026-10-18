import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { loadLinkChecks, runLinkChecks, LINK_CHECK_PREFIX } from './link-check-workspace';
import { linkCheckFilters, linkCheckUrl } from '$lib/link-checks';
import { actions, load } from '../../../routes/admin/link-checks/+page.server';
const connections: DatabaseSync[] = [];
function fixture(count = 225) {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
	sqlite.exec("INSERT INTO categories(id,type,name,slug) VALUES(1,'site','工具','tools');");
	for (let id = 1; id <= count; id++) {
		sqlite
			.prepare(
				"INSERT INTO items(id,type,title,slug,category_id,status,visibility) VALUES(?,'site',?,?,1,?,?)"
			)
			.run(
				id,
				'网址 ' + id,
				'item-' + id,
				id % 2 ? 'draft' : 'published',
				id % 3 ? 'private' : 'public'
			);
		sqlite
			.prepare("INSERT INTO item_meta(item_id,meta_key,meta_value) VALUES(?,'site_url',?)")
			.run(id, 'https://example.com/' + id);
	}
	const db: Database = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const st: DatabaseStatement = {
				bind(...next) {
					expect(next.length).toBeLessThanOrEqual(100);
					values = next;
					return st;
				},
				async all<T>() {
					return {
						results: sqlite.prepare(query).all(...(values as (string | number | null)[])) as T[]
					};
				}
			};
			return st;
		}
	};
	return { sqlite, db };
}
const resolveHost = async () => ['93.184.216.34'];
const success = {
	resolveHost,
	fetcher: (async () => new Response(null, { status: 200 })) as typeof fetch
};
const params = (result: string) => new URLSearchParams({ result });
afterEach(() => {
	vi.useRealTimers();
	connections.splice(0).forEach((db) => db.close());
});
describe('manual link-check workspace', () => {
	it('paginates every matching URL, including draft/private entries, and searches URL/title', async () => {
		const { db } = fixture();
		const ids: number[] = [];
		for (let page = 1; page <= 12; page++) {
			const data = await loadLinkChecks(db, new URLSearchParams({ page: String(page) }));
			expect(data.total).toBe(225);
			ids.push(...data.items.map((row) => row.id));
		}
		expect(new Set(ids).size).toBe(225);
		expect(
			(await loadLinkChecks(db, new URLSearchParams({ q: 'example.com/225' }))).items[0]
		).toMatchObject({ id: 225, publication: 'draft', visibility: 'public' });
		expect((await loadLinkChecks(db, new URLSearchParams({ page: '999999' }))).page).toBe(12);
	});
	it('stores only diagnostic settings; filters complete results and marks URL edits stale', async () => {
		const { db, sqlite } = fixture();
		const before = sqlite.prepare('SELECT * FROM items').all();
		expect(await runLinkChecks(db, [1, 225], success)).toEqual({ saved: 2, skipped: 0 });
		expect((await loadLinkChecks(db, params('reachable'))).items.map((row) => row.id)).toEqual([
			225, 1
		]);
		expect((await loadLinkChecks(db, params('unchecked'))).total).toBe(223);
		expect(sqlite.prepare('SELECT * FROM items').all()).toEqual(before);
		expect(sqlite.prepare('SELECT COUNT(*) n FROM item_meta').get()).toEqual({ n: 225 });
		sqlite.exec("UPDATE item_meta SET meta_value='https://example.com/new' WHERE item_id=225");
		expect((await loadLinkChecks(db, params('stale'))).items[0]).toMatchObject({
			id: 225,
			url: 'https://example.com/new',
			result: { url: 'https://example.com/225' }
		});
		expect((await loadLinkChecks(db, params('reachable'))).total).toBe(1);
	});
	it('keeps malformed stored results out of current result filters', async () => {
		const { db, sqlite } = fixture(1);
		for (const value of ['broken', '{}', '{"url":"https://example.com/1","status":"invalid"}']) {
			sqlite
				.prepare('INSERT OR REPLACE INTO settings(key,value_json) VALUES(?,?)')
				.run(LINK_CHECK_PREFIX + 'item:1', value);
			expect((await loadLinkChecks(db, params('unchecked'))).total).toBe(1);
		}
	});
	it('rejects empty, duplicate, oversized, malformed and stale selections without partial results', async () => {
		const { db, sqlite } = fixture(3);
		for (const ids of [[], [1, 1], [1, 2, 3, 4], ['1'], [1.1], [0], [-1]])
			await expect(runLinkChecks(db, ids, success)).rejects.toMatchObject({ status: 400 });
		await expect(runLinkChecks(db, [1, 999], success)).rejects.toMatchObject({ status: 409 });
		expect(
			sqlite.prepare("SELECT * FROM settings WHERE key GLOB 'admin:link-check:*'").all()
		).toEqual([]);
	});
	it('runs at most two probes concurrently and rejects an overlapping run', async () => {
		const { db } = fixture(3);
		let active = 0,
			peak = 0,
			entered!: () => void,
			release!: () => void;
		const started = new Promise<void>((resolve) => (entered = resolve)),
			gate = new Promise<void>((resolve) => (release = resolve));
		const fetcher: typeof fetch = async () => {
			active++;
			peak = Math.max(peak, active);
			entered();
			await gate;
			active--;
			return new Response();
		};
		const first = runLinkChecks(db, [1, 2, 3], { resolveHost, fetcher });
		await started;
		await expect(runLinkChecks(db, [1], success)).rejects.toMatchObject({ status: 409 });
		release();
		expect(await first).toEqual({ saved: 3, skipped: 0 });
		expect(peak).toBe(2);
	});
	it('does not persist a probe for a URL edited in flight', async () => {
		const { db, sqlite } = fixture(2);
		const fetcher: typeof fetch = async () => {
			sqlite.exec("UPDATE item_meta SET meta_value='https://example.com/new' WHERE item_id=1");
			return new Response();
		};
		expect(await runLinkChecks(db, [1, 2], { resolveHost, fetcher })).toEqual({
			saved: 1,
			skipped: 1
		});
		expect((await loadLinkChecks(db, params('unchecked'))).items.map((row) => row.id)).toEqual([1]);
	});
	it('an expired run cannot overwrite results or release a newer lease', async () => {
		const { db, sqlite } = fixture(1);
		const key = LINK_CHECK_PREFIX + 'lease';
		const fetcher: typeof fetch = async () => {
			sqlite
				.prepare('UPDATE settings SET value_json=? WHERE key=?')
				.run(JSON.stringify({ token: 'new-run', expires: Date.now() + 60000 }), key);
			return new Response();
		};
		expect(await runLinkChecks(db, [1], { resolveHost, fetcher })).toEqual({
			saved: 0,
			skipped: 1
		});
		expect(sqlite.prepare('SELECT value_json FROM settings WHERE key=?').get(key)).toMatchObject({
			value_json: expect.stringContaining('new-run')
		});
	});
	it('recovers expired leases and always releases an owned lease after an invalid selection', async () => {
		const { db, sqlite } = fixture(1);
		sqlite
			.prepare('INSERT INTO settings(key,value_json) VALUES(?,?)')
			.run(LINK_CHECK_PREFIX + 'lease', JSON.stringify({ token: 'expired', expires: 0 }));
		expect(await runLinkChecks(db, [1], success)).toEqual({ saved: 1, skipped: 0 });
		await expect(runLinkChecks(db, [2], success)).rejects.toMatchObject({ status: 409 });
		expect(
			sqlite.prepare('SELECT COUNT(*) n FROM settings WHERE key=?').get(LINK_CHECK_PREFIX + 'lease')
		).toEqual({ n: 0 });
	});
	it('normalizes list links and handles form origin, missing database and invalid IDs', async () => {
		expect(linkCheckFilters(new URLSearchParams('result=constructor&page=-1'))).toMatchObject({
			result: 'all',
			page: 1
		});
		expect(linkCheckUrl(new URLSearchParams('q=中文&result=gone&page=2&edit=999'))).toBe(
			'/admin/link-checks?q=%E4%B8%AD%E6%96%87&result=gone&page=2'
		);
		const { db } = fixture(1);
		const invoke = (ids: string[], origin = 'http://localhost', database: Database | null = db) => {
			const body = new FormData();
			ids.forEach((id) => body.append('ids', id));
			return actions.check!({
				platform: { env: { DB: database } },
				request: new Request('http://localhost/admin/link-checks?/check', {
					method: 'POST',
					body,
					headers: { origin }
				})
			} as never);
		};
		expect(await invoke(['1'], 'https://evil.example')).toMatchObject({ status: 403 });
		expect(await invoke(['1x'])).toMatchObject({ status: 400 });
		expect(await invoke(['1'], 'http://localhost', null)).toMatchObject({ status: 503 });
		await expect(
			load({ platform: undefined, url: new URL('http://localhost/admin/link-checks') } as never)
		).rejects.toMatchObject({ status: 503 });
	});
});
