import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { AiRateLimitError, assertAiRateLimit, recordAiUsage } from '$lib/server/services/ai-usage';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE ai_usage_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action TEXT,provider_id INTEGER,success INTEGER,error_code TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`
	);
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
afterEach(() => connections.splice(0).forEach((c) => c.close()));
describe('AI enrichment usage limits', () => {
	it('allows normal usage and records auditable outcomes', async () => {
		const { database, sqlite } = fixture();
		await expect(assertAiRateLimit(database, 7)).resolves.toBeUndefined();
		await recordAiUsage(database, {
			userId: 7,
			action: 'enrich',
			providerId: 2,
			success: true,
			errorCode: null
		});
		expect(
			sqlite.prepare('SELECT user_id,action,provider_id,success FROM ai_usage_events').get()
		).toEqual({ user_id: 7, action: 'enrich', provider_id: 2, success: 1 });
	});
	it('rejects bursts and ten requests inside the rolling window', async () => {
		const { database, sqlite } = fixture();
		sqlite
			.prepare(
				"INSERT INTO ai_usage_events(user_id,action,success,created_at) VALUES(7,'enrich',1,CURRENT_TIMESTAMP)"
			)
			.run();
		await expect(assertAiRateLimit(database, 7)).rejects.toBeInstanceOf(AiRateLimitError);
		sqlite.exec('DELETE FROM ai_usage_events;');
		for (let i = 0; i < 10; i++)
			sqlite
				.prepare(
					"INSERT INTO ai_usage_events(user_id,action,success,created_at) VALUES(7,'enrich',1,datetime('now',?))"
				)
				.run(`-${i + 1} minutes`);
		await expect(assertAiRateLimit(database, 7)).rejects.toThrow('10 分钟');
	});
});
