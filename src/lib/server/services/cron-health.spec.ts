import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { executeMonitoredHotnewsCron, listCronRuns } from '$lib/server/services/cron-health';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,status TEXT);CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,sender_id INTEGER,type TEXT,title TEXT,content TEXT,data_json TEXT,is_read INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE cron_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,cron TEXT,scheduled_at TEXT,started_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT,status TEXT,total_sources INTEGER DEFAULT 0,succeeded_sources INTEGER DEFAULT 0,failed_sources INTEGER DEFAULT 0,result_json TEXT,error_message TEXT);INSERT INTO users VALUES(1,'admin','active'),(2,'admin','disabled'),(3,'user','active');`
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
});
