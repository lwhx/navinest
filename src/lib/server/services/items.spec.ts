import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { listItems } from '$lib/server/services/items';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE categories(id INTEGER PRIMARY KEY,name TEXT,slug TEXT);CREATE TABLE items(id INTEGER PRIMARY KEY,type TEXT,category_id INTEGER,author_id INTEGER,title TEXT,slug TEXT,summary TEXT,content TEXT,cover_file_id INTEGER,icon_file_id INTEGER,status TEXT,visibility TEXT,sort_order INTEGER,is_featured INTEGER,published_at TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE item_tags(item_id INTEGER,tag_id INTEGER);CREATE TABLE tags(id INTEGER,slug TEXT,name TEXT);CREATE TABLE item_meta(item_id INTEGER,meta_key TEXT,meta_value TEXT);INSERT INTO items VALUES(1,'site',NULL,NULL,'Draft','draft',NULL,NULL,NULL,NULL,'draft','private',0,0,NULL,'','');`
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
describe('items query', () => {
	it('omits WHERE when administrators request every status and visibility', async () => {
		const items = await listItems(fixture(), { status: null, visibility: null });
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ slug: 'draft', status: 'draft', visibility: 'private' });
	});
});
