import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { AiRateLimitError, finalizeAiUsage, reserveAiUsage } from '$lib/server/services/ai-usage';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`CREATE TABLE ai_usage_events(
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER,
		action TEXT,
		provider_id INTEGER,
		success INTEGER,
		error_code TEXT,
		reservation_token TEXT UNIQUE,
		status TEXT NOT NULL DEFAULT 'completed',
		created_at TEXT DEFAULT CURRENT_TIMESTAMP,
		finished_at TEXT
	);`);
	const database: Database = {
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
	return { sqlite, database };
}
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('AI enrichment usage reservations', () => {
	it('reserves before work and finalizes the same auditable event', async () => {
		const { database, sqlite } = fixture();
		const reservation = await reserveAiUsage(database, 7, 'token-1');
		expect(reservation).toEqual({ id: 1, token: 'token-1' });
		expect(sqlite.prepare('SELECT status,success FROM ai_usage_events WHERE id=1').get()).toEqual({
			status: 'in_flight',
			success: 0
		});
		await finalizeAiUsage(database, {
			token: reservation.token,
			providerId: 2,
			success: true,
			errorCode: null
		});
		expect(
			sqlite
				.prepare('SELECT provider_id,status,success,error_code FROM ai_usage_events WHERE id=1')
				.get()
		).toEqual({ provider_id: 2, status: 'completed', success: 1, error_code: null });
	});

	it('atomically rejects a second concurrent reservation inside the burst interval', async () => {
		const { database, sqlite } = fixture();
		await reserveAiUsage(database, 7, 'first');
		await expect(reserveAiUsage(database, 7, 'second')).rejects.toBeInstanceOf(AiRateLimitError);
		expect(sqlite.prepare('SELECT COUNT(*) count FROM ai_usage_events').get()).toEqual({
			count: 1
		});
	});

	it('rejects the eleventh reservation inside the rolling window', async () => {
		const { database, sqlite } = fixture();
		for (let index = 0; index < 10; index++)
			sqlite
				.prepare(
					"INSERT INTO ai_usage_events(user_id,action,success,reservation_token,status,created_at) VALUES(7,'enrich',1,?,'completed',datetime('now',?))"
				)
				.run(`old-${index}`, `-${index + 1} minutes`);
		await expect(reserveAiUsage(database, 7, 'eleventh')).rejects.toThrow('10 分钟');
	});
});
