import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { moveHotSource } from '$lib/server/services/hot-sources';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		'CREATE TABLE hot_sources(id INTEGER PRIMARY KEY,sort_order INTEGER,updated_at TEXT); INSERT INTO hot_sources(id,sort_order) VALUES(1,30),(2,10),(3,20)'
	);
	const database: Database & { batch(statements: DatabaseStatement[]): Promise<void> } = {
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
							.all(
								...values.map((value) =>
									value instanceof ArrayBuffer ? new Uint8Array(value) : value
								)
							) as T[]
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
	return { sqlite, database };
}
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('hot board ordering', () => {
	it('moves one board by one position and rewrites a complete stable order', async () => {
		const { sqlite, database } = fixture();
		await moveHotSource(database, 1, 'up');
		expect(
			sqlite.prepare('SELECT id,sort_order FROM hot_sources ORDER BY sort_order,id').all()
		).toEqual([
			{ id: 2, sort_order: 10 },
			{ id: 1, sort_order: 20 },
			{ id: 3, sort_order: 30 }
		]);
		await moveHotSource(database, 2, 'down');
		expect(sqlite.prepare('SELECT id FROM hot_sources ORDER BY sort_order,id').all()).toEqual([
			{ id: 1 },
			{ id: 2 },
			{ id: 3 }
		]);
	});
	it('keeps the first and last board in place at their boundaries', async () => {
		const { sqlite, database } = fixture();
		await moveHotSource(database, 2, 'up');
		await moveHotSource(database, 1, 'down');
		expect(sqlite.prepare('SELECT id FROM hot_sources ORDER BY sort_order,id').all()).toEqual([
			{ id: 2 },
			{ id: 3 },
			{ id: 1 }
		]);
	});
});
