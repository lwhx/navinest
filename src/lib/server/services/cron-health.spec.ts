import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { executeMonitoredHotnewsCron, listCronRuns } from '$lib/server/services/cron-health';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,status TEXT);CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,sender_id INTEGER,type TEXT,title TEXT,content TEXT,data_json TEXT,is_read INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE cron_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,cron TEXT,scheduled_at TEXT,started_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT,status TEXT,total_sources INTEGER DEFAULT 0,succeeded_sources INTEGER DEFAULT 0,failed_sources INTEGER DEFAULT 0,result_json TEXT,error_message TEXT);CREATE TABLE hot_sources(id INTEGER PRIMARY KEY,name TEXT,url TEXT,is_enabled INTEGER DEFAULT 1,last_success_at TEXT,last_error TEXT,cache_ttl INTEGER DEFAULT 900);INSERT INTO users VALUES(1,'admin','active'),(2,'admin','disabled'),(3,'user','active');`
	);
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
afterEach(() => connections.splice(0).forEach((x) => x.close()));
describe('cron health', () => {
	it('records a successful run', async () => {
		const { db } = fixture();
		const result = await executeMonitoredHotnewsCron(
			db,
			'15 1 * * *',
			Date.parse('2026-07-13T01:15:00Z'),
			async () => [{ ok: true as const, sourceId: 4, count: 10 }]
		);
		expect(result).toMatchObject({
			status: 'success',
			totalSources: 1,
			succeededSources: 1,
			failedSources: 0
		});
		expect((await listCronRuns(db))[0]).toMatchObject({
			cron: '15 1 * * *',
			status: 'success',
			scheduledAt: '2026-07-13T01:15:00.000Z'
		});
	});
	it('records partial failure and alerts only active administrators', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO hot_sources(id,name,last_error,last_success_at) VALUES(4,'正常源',NULL,CURRENT_TIMESTAMP),(5,'失败源','HTTP 500',CURRENT_TIMESTAMP)"
		);
		await executeMonitoredHotnewsCron(
			db,
			'15 1 * * *',
			Date.parse('2026-07-13T01:15:00Z'),
			async () => [
				{ ok: true as const, sourceId: 4, count: 10 },
				{ ok: false as const, sourceId: 5, error: 'HTTP 500' }
			]
		);
		expect((await listCronRuns(db))[0]).toMatchObject({
			status: 'partial',
			totalSources: 2,
			succeededSources: 1,
			failedSources: 1
		});
		expect(sqlite.prepare('SELECT user_id,type,is_read FROM messages').all()).toEqual([
			{ user_id: 1, type: 'cron_alert', is_read: 0 }
		]);
	});
	it('records fatal failure and rethrows it', async () => {
		const { db } = fixture();
		await expect(
			executeMonitoredHotnewsCron(
				db,
				'15 1 * * *',
				Date.parse('2026-07-13T01:15:00Z'),
				async () => {
					throw new Error('database unavailable');
				}
			)
		).rejects.toThrow('database unavailable');
		expect((await listCronRuns(db))[0]).toMatchObject({
			status: 'failed',
			errorMessage: 'database unavailable'
		});
	});
	it('pushes failures and stale boards to the external webhook', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO hot_sources(id,name,is_enabled,last_success_at) VALUES(4,'百度热点',1,'2020-01-01 00:00:00'),(5,'微博热搜',1,CURRENT_TIMESTAMP),(6,'停用榜',0,'2020-01-01 00:00:00'); UPDATE hot_sources SET last_error='HTTP 500' WHERE id=4"
		);
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		await executeMonitoredHotnewsCron(
			db,
			'15 1 * * *',
			Date.parse('2026-07-13T01:15:00Z'),
			async () => [
				{ ok: true as const, sourceId: 5, count: 10 },
				{ ok: false as const, sourceId: 4, error: 'HTTP 500' }
			],
			{
				alertWebhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
				fetcher: (async (url: RequestInfo | URL, init?: RequestInit) => {
					calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
					return new Response('ok');
				}) as typeof fetch
			}
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain('qyapi.weixin.qq.com');
		expect(calls[0].body).toMatchObject({
			msgtype: 'text',
			text: { content: expect.stringContaining('1 个热榜源刷新失败') }
		});
	});
	it('alerts externally when an enabled board silently stopped updating', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO hot_sources(id,name,is_enabled,last_success_at) VALUES(4,'百度热点',1,'2020-01-01 00:00:00')"
		);
		const bodies: Record<string, unknown>[] = [];
		await executeMonitoredHotnewsCron(
			db,
			'15 1 * * *',
			Date.parse('2026-07-13T01:15:00Z'),
			async () => [{ ok: true as const, sourceId: 4, count: 10 }],
			{
				alertWebhookUrl: 'https://hooks.example.com/navinest',
				fetcher: (async (_url: RequestInfo | URL, init?: RequestInit) => {
					bodies.push(JSON.parse(String(init?.body)));
					return new Response('ok');
				}) as typeof fetch
			}
		);
		expect(sqlite.prepare('SELECT COUNT(*) count FROM messages').get()).toMatchObject({ count: 1 });
		expect(bodies[0]).toMatchObject({
			event: 'navinest.alert',
			data: {
				_hotHealth: { issues: [{ sourceId: 4, name: '百度热点', kind: 'stale' }] }
			}
		});
	});
	it('stays quiet when every board is fresh and no source failed', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO hot_sources(id,name,is_enabled,last_success_at) VALUES(4,'百度热点',1,CURRENT_TIMESTAMP)"
		);
		let calls = 0;
		const result = await executeMonitoredHotnewsCron(
			db,
			'15 1 * * *',
			Date.parse('2026-07-13T01:15:00Z'),
			async () => [{ ok: true as const, sourceId: 4, count: 10 }],
			{
				alertWebhookUrl: 'https://hooks.example.com/navinest',
				fetcher: (async () => {
					calls += 1;
					return new Response('ok');
				}) as typeof fetch
			}
		);
		expect(calls).toBe(0);
		expect(result).toMatchObject({ status: 'success' });
	});
	it('survives a broken webhook without failing the run', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO hot_sources(id,name,is_enabled,last_success_at) VALUES(4,'百度热点',1,'2020-01-01 00:00:00')"
		);
		const result = await executeMonitoredHotnewsCron(
			db,
			'15 1 * * *',
			Date.parse('2026-07-13T01:15:00Z'),
			async () => [{ ok: false as const, sourceId: 4, error: 'HTTP 500' }],
			{
				alertWebhookUrl: 'https://hooks.example.com/navinest',
				fetcher: (async () => {
					throw new Error('socket closed');
				}) as typeof fetch
			}
		);
		expect(result).toMatchObject({ status: 'failed', failedSources: 1 });
	});
});
