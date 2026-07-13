import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { adjustDailyStat, listRankings, recordView } from '$lib/server/services/rankings';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE items(id INTEGER PRIMARY KEY,type TEXT,title TEXT,slug TEXT,status TEXT,visibility TEXT);CREATE TABLE stats_daily(id INTEGER PRIMARY KEY AUTOINCREMENT,item_id INTEGER,date TEXT,views INTEGER DEFAULT 0,likes INTEGER DEFAULT 0,favorites INTEGER DEFAULT 0,comments INTEGER DEFAULT 0,downloads INTEGER DEFAULT 0,UNIQUE(item_id,date));INSERT INTO items VALUES(1,'site','Alpha','alpha','published','public'),(2,'post','Beta','beta','published','public'),(3,'post','Private','private','published','private');`
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
afterEach(() => connections.splice(0).forEach((x) => x.close()));

describe('daily statistics', () => {
	it('increments views and clamps decremented counters at zero', async () => {
		const { database, sqlite } = fixture();
		const now = new Date('2026-07-13T23:00:00Z');
		await recordView(database, 1, now);
		await recordView(database, 1, now);
		await adjustDailyStat(database, 1, 'favorites', 1, now);
		await adjustDailyStat(database, 1, 'favorites', -1, now);
		await adjustDailyStat(database, 1, 'favorites', -1, now);
		expect(
			sqlite.prepare('SELECT date,views,favorites FROM stats_daily WHERE item_id=1').get()
		).toMatchObject({ date: '2026-07-13', views: 2, favorites: 0 });
	});
	it('rejects statistics for private or missing items', async () => {
		const { database } = fixture();
		await expect(recordView(database, 3)).rejects.toThrow();
		await expect(recordView(database, 99)).rejects.toThrow();
	});
});

describe('rankings', () => {
	it('aggregates day, rolling week, calendar month and total periods', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec(
			`INSERT INTO stats_daily(item_id,date,views,likes,favorites) VALUES(1,'2026-07-13',2,0,1),(1,'2026-07-07',5,0,0),(1,'2026-07-01',7,0,0),(2,'2026-07-13',3,1,0),(2,'2026-06-30',20,0,0);`
		);
		const now = new Date('2026-07-13T12:00:00Z');
		expect((await listRankings(database, 'day', now))[0]).toMatchObject({
			id: 1,
			views: 2,
			favorites: 1,
			score: 5
		});
		expect((await listRankings(database, 'week', now))[0]).toMatchObject({
			id: 1,
			views: 7,
			favorites: 1,
			score: 10
		});
		expect((await listRankings(database, 'month', now))[0]).toMatchObject({
			id: 1,
			views: 14,
			favorites: 1,
			score: 17
		});
		expect((await listRankings(database, 'total', now))[0]).toMatchObject({
			id: 2,
			views: 23,
			likes: 1,
			score: 25
		});
	});
});
