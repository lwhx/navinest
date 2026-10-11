import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { buildHomeModulePlan } from '$lib/server/services/home-module-plan';
import { loadHomeDashboard } from '$lib/server/services/home-dashboard';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE home_modules(id INTEGER PRIMARY KEY,type TEXT,title TEXT,config_json TEXT,sort_order INTEGER,is_enabled INTEGER,created_at TEXT,updated_at TEXT);CREATE TABLE items(id INTEGER PRIMARY KEY,type TEXT,title TEXT,slug TEXT,status TEXT,visibility TEXT);CREATE TABLE categories(id INTEGER PRIMARY KEY,is_visible INTEGER);CREATE TABLE users(id INTEGER PRIMARY KEY,status TEXT);CREATE TABLE stats_daily(id INTEGER PRIMARY KEY,item_id INTEGER,date TEXT,views INTEGER,likes INTEGER,favorites INTEGER);CREATE TABLE hot_sources(id INTEGER PRIMARY KEY,name TEXT,type TEXT,is_enabled INTEGER,last_fetch_at TEXT,sort_order INTEGER DEFAULT 0);CREATE TABLE hot_items(id INTEGER PRIMARY KEY,source_id INTEGER,rank INTEGER,title TEXT,url TEXT,hot_value TEXT,extra_json TEXT,fetched_at TEXT);INSERT INTO home_modules VALUES(1,'search','搜索','{}',10,1,'',''),(2,'ranking','排行','{"limit":10}',30,1,'',''),(3,'hot','隐藏','{}',20,0,'','');INSERT INTO items VALUES(1,'site','Alpha','alpha','published','public'),(2,'post','Beta','beta','published','public');INSERT INTO categories VALUES(1,1),(2,0);INSERT INTO users VALUES(1,'active'),(2,'disabled');INSERT INTO stats_daily VALUES(1,1,'2026-07-13',5,0,2),(2,2,'2026-07-13',3,0,0);INSERT INTO hot_sources VALUES(1,'News','rss',1,'2026-07-13 01:25:00',0);INSERT INTO hot_items VALUES(1,1,1,'Headline','https://example.com','100','{}','2026-07-13 01:25:00');`
	);
	const db: Database = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const s: DatabaseStatement = {
				bind(...next) {
					values = next;
					return s;
				},
				async all<T>() {
					return {
						results: sqlite
							.prepare(query)
							.all(...values.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v))) as T[]
					};
				}
			};
			return s;
		}
	};
	return db;
}
afterEach(() => connections.splice(0).forEach((x) => x.close()));
describe('home dashboard', () => {
	it('loads enabled modules, real rankings, hotnews and public counts', async () => {
		const result = await loadHomeDashboard(fixture());
		expect(result.modules.map((x) => x.type)).toEqual(['search', 'ranking']);
		expect(result.stats).toEqual({ items: 2, categories: 1, users: 1 });
		expect(result.popular[0]).toMatchObject({
			id: 1,
			title: 'Alpha',
			views: 5,
			favorites: 2,
			score: 11
		});
		expect(result.hotnews[0]).toMatchObject({ source: 'News', rank: 1, title: 'Headline' });
	});
});

describe('disabled homepage category configuration', () => {
	it('reads disabled category slugs without re-enabling modules or changing rankings', async () => {
		const db = fixture();
		await db
			.prepare(
				`INSERT INTO home_modules VALUES(4,'content','隐藏分类','{"categorySlug":"design"}',40,0,'','')`
			)
			.all();
		const dashboard = await loadHomeDashboard(db);
		expect(dashboard.disabledCategorySlugs).toEqual(['design']);
		expect(dashboard.modules.map((entry) => entry.type)).toEqual(['search', 'ranking']);
		expect(
			buildHomeModulePlan(
				dashboard.modules,
				[{ slug: 'design', name: '设计' }],
				dashboard.disabledCategorySlugs
			).some((entry) => entry.type === 'content')
		).toBe(false);
		expect(dashboard.popular[0].score).toBe(11);
	});
	it('ignores malformed disabled configuration instead of falling back to default modules', async () => {
		const db = fixture();
		for (const [index, config] of ['invalid', 'null', '{}'].entries()) {
			await db
				.prepare("INSERT INTO home_modules VALUES(?,'content','隐藏',?,40,0,'','')")
				.bind(index + 4, config)
				.all();
		}
		const dashboard = await loadHomeDashboard(db);
		expect(dashboard.disabledCategorySlugs).toEqual([]);
		expect(dashboard.modules.map((entry) => entry.type)).toEqual(['search', 'ranking']);
	});
});
