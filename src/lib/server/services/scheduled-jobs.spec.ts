import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	BACKUP_CRON,
	HOTNEWS_CRON,
	MAINTENANCE_CRON,
	runScheduledJob
} from '$lib/server/services/scheduled-jobs';
import type { BackupBucket } from '$lib/server/services/scheduled-backup';
import type { SiteBackup } from '$lib/server/services/site-backup';

const connections: DatabaseSync[] = [];

function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,status TEXT);CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,sender_id INTEGER,type TEXT,title TEXT,content TEXT,data_json TEXT,is_read INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE cron_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,cron TEXT,scheduled_at TEXT,started_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT,status TEXT,total_sources INTEGER DEFAULT 0,succeeded_sources INTEGER DEFAULT 0,failed_sources INTEGER DEFAULT 0,result_json TEXT,error_message TEXT);CREATE TABLE hot_sources(id INTEGER PRIMARY KEY,name TEXT,type TEXT,url TEXT,headers_json TEXT DEFAULT '{}',parser_json TEXT DEFAULT '{}',cache_ttl INTEGER DEFAULT 900,is_enabled INTEGER DEFAULT 0,last_fetch_at TEXT,last_success_at TEXT,last_error TEXT,refresh_token TEXT,refresh_started_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE login_attempts(attempt_key TEXT PRIMARY KEY,failed_count INTEGER DEFAULT 0,window_started_at TEXT DEFAULT CURRENT_TIMESTAMP,locked_until TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE ai_usage_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action TEXT,reservation_token TEXT,status TEXT DEFAULT 'completed',created_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT);INSERT INTO users VALUES(1,'admin','active'),(2,'user','active');`
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
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

function memoryBucket() {
	const store = new Map<string, string>();
	const bucket: BackupBucket = {
		async put(key, value) {
			store.set(key, value);
			return null;
		},
		async list(options) {
			return {
				objects: [...store.keys()]
					.filter((key) => key.startsWith(options?.prefix ?? ''))
					.map((key) => ({ key }))
			};
		},
		async delete(key) {
			store.delete(key);
			return null;
		}
	};
	return { bucket, store };
}

const exporter = (async () =>
	({ generatedAt: '2026-09-27T19:00:00.000Z' }) as unknown as SiteBackup) as (
	db: Database,
	now?: Date
) => Promise<SiteBackup>;

describe('scheduled job dispatch', () => {
	it('routes the hotnews trigger through the monitored cron', async () => {
		const { db, sqlite } = fixture();
		const result = await runScheduledJob(db, HOTNEWS_CRON, Date.parse('2026-07-13T01:15:00Z'));
		expect(result).toMatchObject({ job: 'hotnews', status: 'success', failedSources: 0 });
		expect(sqlite.prepare('SELECT status FROM cron_runs').all()).toEqual([{ status: 'success' }]);
	});

	it('writes a snapshot for the backup trigger', async () => {
		const { db } = fixture();
		const { bucket, store } = memoryBucket();
		const result = await runScheduledJob(db, BACKUP_CRON, Date.parse('2026-09-27T19:00:00Z'), {
			bucket,
			exporter
		});
		expect(result).toMatchObject({ job: 'backup', key: 'backups/navinest-2026-09-27.json' });
		expect([...store.keys()]).toEqual(['backups/navinest-2026-09-27.json']);
		expect(JSON.parse(store.get('backups/navinest-2026-09-27.json') ?? '{}')).toMatchObject({
			generatedAt: '2026-09-27T19:00:00.000Z'
		});
	});

	it('alerts administrators and the webhook before rethrowing a failed backup', async () => {
		const { db, sqlite } = fixture();
		const alerts: string[] = [];
		await expect(
			runScheduledJob(db, BACKUP_CRON, Date.parse('2026-09-27T19:00:00Z'), {
				exporter,
				alertWebhookUrl: 'https://hooks.example.com/navinest',
				fetcher: (async (_url: RequestInfo | URL, init?: RequestInit) => {
					alerts.push(String(init?.body));
					return new Response('ok');
				}) as typeof fetch
			})
		).rejects.toThrow('未配置备份存储');
		expect(sqlite.prepare('SELECT user_id,type,title FROM messages').all()).toEqual([
			{ user_id: 1, type: 'cron_alert', title: '定时备份失败' }
		]);
		expect(alerts).toHaveLength(1);
		expect(JSON.parse(alerts[0])).toMatchObject({ event: 'navinest.alert', title: '定时备份失败' });
	});

	it('reports unknown triggers without touching the database', async () => {
		const { db, sqlite } = fixture();
		expect(await runScheduledJob(db, '0 0 * * *', Date.parse('2026-09-27T00:00:00Z'))).toEqual({
			job: 'unknown',
			cron: '0 0 * * *'
		});
		expect(sqlite.prepare('SELECT COUNT(*) count FROM cron_runs').get()).toMatchObject({
			count: 0
		});
		expect(sqlite.prepare('SELECT COUNT(*) count FROM messages').get()).toMatchObject({ count: 0 });
	});
	it('runs housekeeping for the maintenance trigger', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			`CREATE TABLE user_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at TEXT NOT NULL);
			 INSERT INTO user_sessions VALUES('stale',1,'2020-01-01T00:00:00.000Z');`
		);
		const result = await runScheduledJob(db, MAINTENANCE_CRON, Date.parse('2026-09-27T03:00:00Z'));
		expect(result).toMatchObject({ job: 'maintenance', expiredSessions: 1 });
		expect(sqlite.prepare('SELECT COUNT(*) count FROM user_sessions').get()).toMatchObject({
			count: 0
		});
	});
});
