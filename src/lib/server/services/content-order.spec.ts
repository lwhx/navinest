import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { AdminWriteError } from '$lib/server/services/admin-write';
import { reorderItems } from '$lib/server/services/content-order';
const connections: DatabaseSync[] = [];
function setup() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE items(id INTEGER PRIMARY KEY,type TEXT NOT NULL,category_id INTEGER,sort_order INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);INSERT INTO items(id,type,category_id,sort_order) VALUES(1,'site',2,10),(2,'site',2,20),(3,'site',2,30),(4,'site',3,10),(5,'post',2,10);`
	);
	const db: Database & { batch(s: DatabaseStatement[]): Promise<void> } = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement: DatabaseStatement = {
				bind(...next) {
					values = next;
					return statement;
				},
				async all<T>() {
					const sqliteValues = values.map((value) =>
						value instanceof ArrayBuffer ? new Uint8Array(value) : value
					);
					return { results: sqlite.prepare(query).all(...sqliteValues) as T[] };
				}
			};
			return statement;
		},
		async batch(statements) {
			sqlite.exec('BEGIN');
			try {
				for (const s of statements) await s.all();
				sqlite.exec('COMMIT');
			} catch (e) {
				sqlite.exec('ROLLBACK');
				throw e;
			}
		}
	};
	return { db, sqlite };
}
afterEach(() => {
	for (const c of connections.splice(0)) c.close();
});
describe('manual content ordering', () => {
	it('atomically assigns spaced order values inside one type and category', async () => {
		const { db, sqlite } = setup();
		await reorderItems(db, { type: 'site', categoryId: 2, itemIds: [3, 1, 2] });
		expect(
			sqlite
				.prepare(
					"SELECT id,sort_order FROM items WHERE category_id=2 AND type='site' ORDER BY sort_order"
				)
				.all()
		).toEqual([
			{ id: 3, sort_order: 10 },
			{ id: 1, sort_order: 20 },
			{ id: 2, sort_order: 30 }
		]);
	});
	it('rejects duplicate, missing, or out-of-scope item ids', async () => {
		const { db } = setup();
		for (const itemIds of [
			[1, 1, 2],
			[1, 2],
			[1, 2, 4]
		])
			await expect(
				reorderItems(db, { type: 'site', categoryId: 2, itemIds })
			).rejects.toBeInstanceOf(AdminWriteError);
	});
});
