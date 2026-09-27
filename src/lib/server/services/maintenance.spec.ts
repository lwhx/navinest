import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { runMaintenance } from '$lib/server/services/maintenance';

const connections: DatabaseSync[] = [];

function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE user_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP);
		 CREATE TABLE login_attempts(attempt_key TEXT PRIMARY KEY,failed_count INTEGER DEFAULT 0,window_started_at TEXT DEFAULT CURRENT_TIMESTAMP,locked_until TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
		 CREATE TABLE cron_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,cron TEXT,scheduled_at TEXT,started_at TEXT DEFAULT CURRENT_TIMESTAMP,status TEXT DEFAULT 'success');
		 CREATE TABLE ai_usage_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action TEXT,reservation_token TEXT,status TEXT DEFAULT 'completed',created_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT);`
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

describe('scheduled maintenance', () => {
	it('removes only expired sessions', async () => {
		const { db, sqlite } = fixture();
		const past = new Date(Date.now() - 86_400_000).toISOString(),
			future = new Date(Date.now() + 86_400_000).toISOString();
		sqlite.exec(
			`INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES('old',1,'${past}'),('live',1,'${future}')`
		);
		const result = await runMaintenance(db);
		expect(result.expiredSessions).toBe(1);
		expect(sqlite.prepare('SELECT token_hash FROM user_sessions').all()).toEqual([
			{ token_hash: 'live' }
		]);
	});

	it('clears stale login windows but keeps active locks', async () => {
		const { db, sqlite } = fixture();
		const lockedUntil = new Date(Date.now() + 600_000).toISOString().replace('T', ' ').slice(0, 19);
		sqlite.exec(
			`INSERT INTO login_attempts(attempt_key,window_started_at,locked_until) VALUES
			 ('stale',datetime('now','-3 days'),NULL),
			 ('released',datetime('now','-3 days'),datetime('now','-1 hour')),
			 ('locked',datetime('now','-3 days'),'${lockedUntil}'),
			 ('fresh',datetime('now'),NULL)`
		);
		const result = await runMaintenance(db);
		expect(result.staleLoginAttempts).toBe(2);
		expect(
			sqlite.prepare('SELECT attempt_key FROM login_attempts ORDER BY attempt_key').all()
		).toEqual([{ attempt_key: 'fresh' }, { attempt_key: 'locked' }]);
	});

	it('prunes cron history older than the retention window', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			`INSERT INTO cron_runs(cron,started_at) VALUES
			 ('15 1 * * *','2020-01-01 00:00:00'),
			 ('15 1 * * *',datetime('now','-40 days')),
			 ('15 1 * * *',datetime('now','-2 days'))`
		);
		expect(await runMaintenance(db)).toMatchObject({ prunedCronRuns: 2 });
		expect(sqlite.prepare('SELECT COUNT(*) count FROM cron_runs').get()).toMatchObject({
			count: 1
		});
	});

	it('releases abandoned AI reservations without touching recent or finished rows', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			`INSERT INTO ai_usage_events(user_id,action,reservation_token,status,created_at) VALUES
			 (1,'enrich','token-abandoned','in_flight',datetime('now','-3 hours')),
			 (1,'enrich','token-active','in_flight',datetime('now')),
			 (1,'enrich',NULL,'completed',datetime('now','-3 hours'))`
		);
		expect(await runMaintenance(db)).toMatchObject({ abandonedReservations: 1 });
		expect(
			sqlite.prepare('SELECT reservation_token,status FROM ai_usage_events ORDER BY id').all()
		).toEqual([
			{ reservation_token: null, status: 'abandoned' },
			{ reservation_token: 'token-active', status: 'in_flight' },
			{ reservation_token: null, status: 'completed' }
		]);
	});

	it('honours custom windows and clamps unusable values', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			`INSERT INTO cron_runs(cron,started_at) VALUES('15 1 * * *',datetime('now','-2 days')),('15 1 * * *',datetime('now','-5 hours'))`
		);
		expect(await runMaintenance(db, { cronRunDays: 1 })).toMatchObject({ prunedCronRuns: 1 });
		expect(await runMaintenance(db, { cronRunDays: 0 })).toMatchObject({ prunedCronRuns: 0 });
		expect(sqlite.prepare('SELECT COUNT(*) count FROM cron_runs').get()).toMatchObject({
			count: 1
		});
	});
});
