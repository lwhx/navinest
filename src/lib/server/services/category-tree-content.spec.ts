import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { categoryContent } from '$lib/server/services/content-pages';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE categories(id INTEGER PRIMARY KEY,type TEXT,parent_id INTEGER,name TEXT,slug TEXT,icon TEXT,description TEXT,sort_order INTEGER,is_visible INTEGER,created_at TEXT,updated_at TEXT);CREATE TABLE items(id INTEGER PRIMARY KEY,type TEXT,category_id INTEGER,author_id INTEGER,title TEXT,slug TEXT,summary TEXT,content TEXT,cover_file_id INTEGER,icon_file_id INTEGER,status TEXT,visibility TEXT,sort_order INTEGER,is_featured INTEGER,published_at TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE item_tags(item_id INTEGER,tag_id INTEGER);CREATE TABLE tags(id INTEGER,slug TEXT,name TEXT);CREATE TABLE item_meta(item_id INTEGER,meta_key TEXT,meta_value TEXT);INSERT INTO categories VALUES(1,'site',NULL,'开发工具','dev-tools',NULL,'开发入口',10,1,'',''),(2,'site',1,'前端开发','frontend-dev',NULL,'前端生态',11,1,'',''),(3,'site',1,'部署运维','devops',NULL,'部署工具',12,1,'','');INSERT INTO items VALUES(1,'site',1,NULL,'GitHub','github','','',NULL,NULL,'published','public',1,0,NULL,'',''),(2,'site',2,NULL,'Vite','vite','','',NULL,NULL,'published','public',2,0,NULL,'',''),(3,'site',3,NULL,'Docker','docker','','',NULL,NULL,'published','public',3,0,NULL,'','');`
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
	return database;
}
afterEach(() => connections.splice(0).forEach((x) => x.close()));
describe('category tree content', () => {
	it('aggregates direct and child items for a parent category and exposes child tabs', async () => {
		const data = await categoryContent(fixture(), 'dev-tools');
		expect(data?.items.map((x) => x.title)).toEqual(['GitHub', 'Vite', 'Docker']);
		expect(data?.children).toEqual([
			{ name: '前端开发', slug: 'frontend-dev' },
			{ name: '部署运维', slug: 'devops' }
		]);
	});
	it('keeps child category pages scoped to direct items', async () => {
		const data = await categoryContent(fixture(), 'frontend-dev');
		expect(data?.items.map((x) => x.title)).toEqual(['Vite']);
		expect(data?.children).toEqual([]);
	});
});
