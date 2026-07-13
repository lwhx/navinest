import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	ActivityError,
	listFavorites,
	listFootprints,
	recordFootprint,
	removeFavorite,
	setFavorite
} from '$lib/server/services/user-activity';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
		CREATE TABLE items(id INTEGER PRIMARY KEY,type TEXT,title TEXT,slug TEXT,summary TEXT,status TEXT,visibility TEXT);
		CREATE TABLE favorites(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,item_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,item_id));
		CREATE TABLE footprints(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,item_id INTEGER,visited_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,item_id));
		CREATE TABLE stats_daily(id INTEGER PRIMARY KEY AUTOINCREMENT,item_id INTEGER,date TEXT,views INTEGER DEFAULT 0,likes INTEGER DEFAULT 0,favorites INTEGER DEFAULT 0,comments INTEGER DEFAULT 0,downloads INTEGER DEFAULT 0,UNIQUE(item_id,date));
		INSERT INTO items VALUES(1,'site','GitHub','github','Code hosting','published','public');
		INSERT INTO items VALUES(2,'post','Draft','draft',NULL,'draft','public');
		INSERT INTO items VALUES(3,'post','Private','private',NULL,'published','private');
	`);
	const database: Database = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement: DatabaseStatement = {
				bind(...next) {
					values = next;
					return statement;
				},
				async all<T>() {
					const rows = sqlite
						.prepare(query)
						.all(...values.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v))) as T[];
					return { results: rows };
				}
			};
			return statement;
		}
	};
	return { sqlite, database };
}
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('user favorites', () => {
	it('adds and removes a public item idempotently', async () => {
		const { sqlite, database } = fixture();
		await setFavorite(database, 7, 1);
		await setFavorite(database, 7, 1);
		expect(sqlite.prepare('SELECT COUNT(*) count FROM favorites').get()).toMatchObject({
			count: 1
		});
		expect(sqlite.prepare('SELECT favorites FROM stats_daily WHERE item_id=1').get()).toMatchObject(
			{ favorites: 1 }
		);
		expect(await listFavorites(database, 7)).toMatchObject([
			{ id: 1, title: 'GitHub', slug: 'github', type: 'site' }
		]);
		await removeFavorite(database, 7, 1);
		await removeFavorite(database, 7, 1);
		expect(sqlite.prepare('SELECT COUNT(*) count FROM favorites').get()).toMatchObject({
			count: 0
		});
		expect(sqlite.prepare('SELECT favorites FROM stats_daily WHERE item_id=1').get()).toMatchObject(
			{ favorites: 0 }
		);
	});
	it('rejects drafts, private items and missing items', async () => {
		const { database } = fixture();
		await expect(setFavorite(database, 7, 2)).rejects.toBeInstanceOf(ActivityError);
		await expect(setFavorite(database, 7, 3)).rejects.toBeInstanceOf(ActivityError);
		await expect(setFavorite(database, 7, 99)).rejects.toBeInstanceOf(ActivityError);
	});
});

describe('user footprints', () => {
	it('keeps one most recent visit per user and public item', async () => {
		const { sqlite, database } = fixture();
		await recordFootprint(database, 7, 1, new Date('2026-01-01T00:00:00Z'));
		await recordFootprint(database, 7, 1, new Date('2026-01-02T00:00:00Z'));
		expect(
			sqlite.prepare('SELECT COUNT(*) count,MAX(visited_at) visited_at FROM footprints').get()
		).toMatchObject({ count: 1, visited_at: '2026-01-02T00:00:00.000Z' });
		expect(await listFootprints(database, 7)).toMatchObject([
			{ id: 1, title: 'GitHub', visitedAt: '2026-01-02T00:00:00.000Z' }
		]);
	});
});
