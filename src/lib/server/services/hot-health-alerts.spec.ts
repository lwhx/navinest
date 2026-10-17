import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { reconcileHotAlerts, latestHotAlert, hotIssues } from './hot-health-alerts';
import { executeMonitoredHotnewsCron } from './cron-health';
import { hotHealth, hotDate } from '$lib/hot-health';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,status TEXT);INSERT INTO users VALUES(1,'admin','active'),(2,'admin','disabled'),(3,'user','active'),(4,'admin','active');CREATE TABLE messages(id INTEGER PRIMARY KEY,user_id INTEGER,sender_id INTEGER,type TEXT,title TEXT,content TEXT,data_json TEXT,is_read INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE hot_sources(id INTEGER PRIMARY KEY,name TEXT,is_enabled INTEGER,last_error TEXT,last_success_at TEXT);INSERT INTO hot_sources VALUES(1,'测试榜单',1,NULL,CURRENT_TIMESTAMP);CREATE TABLE cron_runs(id INTEGER PRIMARY KEY,cron TEXT,scheduled_at TEXT,started_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT,status TEXT,total_sources INTEGER,succeeded_sources INTEGER,failed_sources INTEGER,result_json TEXT,error_message TEXT);`
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
	return { db, sqlite };
}
afterEach(() => {
	connections.splice(0).forEach((db) => db.close());
	vi.restoreAllMocks();
});
const issue = { sourceId: 1, name: '测试榜单', kind: 'failed', error: '订阅解析失败' };
const start = new Date('2026-10-17T00:00:00Z');
describe('hot health incident notifications', () => {
	it('alerts active admins once, aggregates repeats, and sends a seven-day reminder', async () => {
		const { db, sqlite } = fixture();
		await reconcileHotAlerts(db, 'first', { issues: [issue], now: start });
		expect(sqlite.prepare('SELECT user_id FROM messages ORDER BY user_id').all()).toEqual([
			{ user_id: 1 },
			{ user_id: 4 }
		]);
		await reconcileHotAlerts(db, 'repeat', {
			issues: [issue],
			now: new Date(start.getTime() + 86400000)
		});
		await reconcileHotAlerts(db, 'repeat', {
			issues: [issue],
			now: new Date(start.getTime() + 86400000)
		});
		expect((await latestHotAlert(db)).state?.observations).toBe(2);
		expect(sqlite.prepare('SELECT COUNT(*) n FROM messages').get()).toEqual({ n: 2 });
		await reconcileHotAlerts(db, 'week', {
			issues: [issue],
			now: new Date(start.getTime() + 7 * 86400000)
		});
		expect((await latestHotAlert(db)).state?.kind).toBe('reminder');
		expect(sqlite.prepare('SELECT COUNT(*) n FROM messages').get()).toEqual({ n: 4 });
	});
	it('notifies changed failures and a single recovery while keeping old observations intact', async () => {
		const { db, sqlite } = fixture();
		await reconcileHotAlerts(db, 'bad', { issues: [issue], now: start });
		await reconcileHotAlerts(db, 'changed', {
			issues: [{ ...issue, error: '源站返回错误（HTTP 503）' }],
			now: start
		});
		expect((await latestHotAlert(db)).state?.kind).toBe('changed');
		await reconcileHotAlerts(db, 'good', { issues: [], now: start });
		await reconcileHotAlerts(db, 'good-again', { issues: [], now: start });
		expect((await latestHotAlert(db)).state?.kind).toBe('recovered');
		expect(sqlite.prepare('SELECT COUNT(*) n FROM messages').get()).toEqual({ n: 6 });
	});
	it('does not announce recovery merely because a board was disabled', async () => {
		const { db, sqlite } = fixture();
		await reconcileHotAlerts(db, 'bad', { issues: [issue], now: start });
		sqlite.exec('UPDATE hot_sources SET is_enabled=0');
		await reconcileHotAlerts(db, 'disabled', { issues: [], now: start });
		expect((await latestHotAlert(db)).state?.kind).toBe('closed');
		expect(sqlite.prepare('SELECT title FROM messages ORDER BY id DESC LIMIT 1').get()).toEqual({
			title: '热榜异常提醒已停止'
		});
	});
	it('keeps task failures pending until a scheduled task observes recovery', async () => {
		const { db } = fixture();
		await reconcileHotAlerts(db, 'fatal', { fatal: 'failed', taskObserved: true, now: start });
		await reconcileHotAlerts(db, 'manual', { now: start });
		expect((await latestHotAlert(db)).state?.issues.map((i) => i.sourceId)).toEqual([0]);
		await reconcileHotAlerts(db, 'task-ok', { taskObserved: true, now: start });
		expect((await latestHotAlert(db)).state?.kind).toBe('recovered');
	});
	it('claims concurrent notifications in SQL and pushes one external webhook', async () => {
		const { db, sqlite } = fixture();
		let calls = 0;
		const options = {
			issues: [issue],
			now: start,
			alertWebhookUrl: 'https://hooks.example.com/hot',
			fetcher: (async () => {
				calls++;
				return new Response('ok');
			}) as typeof fetch
		};
		await Promise.all([reconcileHotAlerts(db, 'a', options), reconcileHotAlerts(db, 'b', options)]);
		expect(calls).toBe(1);
		expect(sqlite.prepare('SELECT COUNT(*) n FROM messages').get()).toEqual({ n: 2 });
	});
	it('records failed webhook delivery without repeatedly pushing the same incident', async () => {
		const { db } = fixture();
		let calls = 0;
		const options = {
			issues: [issue],
			now: start,
			alertWebhookUrl: 'https://hooks.example.com/hot',
			fetcher: (async () => {
				calls++;
				throw new Error('offline');
			}) as typeof fetch
		};
		expect((await reconcileHotAlerts(db, 'a', options)).warning).toBeTruthy();
		await reconcileHotAlerts(db, 'b', options);
		expect(calls).toBe(1);
		expect((await latestHotAlert(db)).state?.webhook).toBe('failed');
	});
	it('keeps actual task results successful even when incident notification storage fails', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"UPDATE hot_sources SET last_error='HTTP 500';CREATE TRIGGER alert_failure BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'alert unavailable'); END"
		);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await executeMonitoredHotnewsCron(db, '15 1 * * *', Date.now(), async () => [
			{ ok: true, sourceId: 1, count: 2 }
		]);
		expect(result.status).toBe('success');
		expect(result.alertWarning).toBeTruthy();
		expect(sqlite.prepare('SELECT status FROM cron_runs').get()).toEqual({ status: 'success' });
	});
	it('ignores corrupt historical JSON and evaluates current source health without leaking source addresses', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO messages(user_id,type,data_json) VALUES(1,'cron_alert','{bad');UPDATE hot_sources SET last_error='HTTP 502'"
		);
		const issues = await hotIssues(db);
		expect(issues[0]).toMatchObject({ kind: 'failed', error: '源站返回错误（HTTP 502）' });
		await reconcileHotAlerts(db, 'current', { issues, now: start });
		expect((await latestHotAlert(db)).state?.kind).toBe('initial');
	});
});
describe('shared hot health semantics', () => {
	it('uses successful timestamps rather than recent failed attempts and formats Beijing time', () => {
		expect(hotHealth({ lastSuccessAt: '2020-01-01 00:00:00' }).kind).toBe('stale');
		expect(hotHealth({ lastSuccessAt: null }).kind).toBe('waiting');
		expect(hotHealth({ isEnabled: false, lastError: 'bad', lastSuccessAt: null }).kind).toBe(
			'disabled'
		);
		expect(hotDate('2026-10-17 00:00:00')).toContain('08:00');
		expect(hotDate('bad')).toBe('暂无记录');
	});
});
