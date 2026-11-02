import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { AdminWriteError } from '$lib/server/services/admin-write';
import { reorderCategories } from '$lib/server/services/category-order';
const connections: DatabaseSync[] = [];
function setup() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE categories(id INTEGER PRIMARY KEY,type TEXT NOT NULL,parent_id INTEGER,sort_order INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
		 INSERT INTO categories(id,type,parent_id,sort_order) VALUES
		 (1,'site',NULL,10),(2,'site',NULL,20),(3,'site',NULL,30),
		 (4,'site',1,10),(5,'site',1,20),
		 (6,'post',NULL,10);`
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
					const sqliteValues = values.map((value) =>
						value instanceof ArrayBuffer ? new Uint8Array(value) : value
					);
					return { results: sqlite.prepare(query).all(...sqliteValues) as T[] };
				}
			};
			return statement;
		}
	};
	return { db, sqlite };
}
afterEach(() => {
	for (const c of connections.splice(0)) c.close();
});
describe('category sibling ordering', () => {
	it('atomically assigns spaced order values to one root sibling scope', async () => {
		const { db, sqlite } = setup();
		await reorderCategories(db, { type: 'site', parentId: null, categoryIds: [3, 1, 2] });
		expect(
			sqlite
				.prepare(
					"SELECT id,sort_order FROM categories WHERE type='site' AND parent_id IS NULL ORDER BY sort_order"
				)
				.all()
		).toEqual([
			{ id: 3, sort_order: 10 },
			{ id: 1, sort_order: 20 },
			{ id: 2, sort_order: 30 }
		]);
		// Siblings under a different parent and other types keep their order.
		expect(
			sqlite.prepare('SELECT id,sort_order FROM categories WHERE id IN (4,5,6) ORDER BY id').all()
		).toEqual([
			{ id: 4, sort_order: 10 },
			{ id: 5, sort_order: 20 },
			{ id: 6, sort_order: 10 }
		]);
	});
	it('reorders child categories within their own parent scope', async () => {
		const { db, sqlite } = setup();
		await reorderCategories(db, { type: 'site', parentId: 1, categoryIds: [5, 4] });
		expect(
			sqlite
				.prepare('SELECT id,sort_order FROM categories WHERE parent_id=1 ORDER BY sort_order')
				.all()
		).toEqual([
			{ id: 5, sort_order: 10 },
			{ id: 4, sort_order: 20 }
		]);
	});
	it('rejects duplicate, missing, or out-of-scope category ids', async () => {
		const { db } = setup();
		for (const categoryIds of [
			[1, 1, 2],
			[1, 2],
			[1, 2, 4],
			[1, 2, 6]
		])
			await expect(
				reorderCategories(db, { type: 'site', parentId: null, categoryIds })
			).rejects.toBeInstanceOf(AdminWriteError);
		await expect(
			reorderCategories(db, { type: 'post', parentId: null, categoryIds: [1, 2] })
		).rejects.toBeInstanceOf(AdminWriteError);
	});
});
