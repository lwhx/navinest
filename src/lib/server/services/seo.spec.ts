import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { buildSitemapXml, listSitemapEntries } from '$lib/server/services/seo';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE categories(id INTEGER PRIMARY KEY,name TEXT,slug TEXT,type TEXT,is_visible INTEGER,updated_at TEXT);CREATE TABLE tags(id INTEGER PRIMARY KEY,name TEXT,slug TEXT,type TEXT,updated_at TEXT);CREATE TABLE items(id INTEGER PRIMARY KEY,type TEXT,slug TEXT,status TEXT,visibility TEXT,updated_at TEXT);INSERT INTO categories VALUES(1,'Visible','visible','site',1,'2026-07-01 00:00:00'),(2,'Hidden','hidden','site',0,'2026-07-02 00:00:00');INSERT INTO tags VALUES(1,'A&B','a-b','site','2026-07-03 00:00:00');INSERT INTO items VALUES(1,'site','public-site','published','public','2026-07-04 00:00:00'),(2,'post','draft','draft','public','2026-07-05 00:00:00'),(3,'book','private','published','private','2026-07-06 00:00:00'),(4,'bulletin','news','published','public','2026-07-07 00:00:00');`
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
describe('sitemap', () => {
	it('lists only indexable routes with correct type paths', async () => {
		const entries = await listSitemapEntries(fixture(), 'https://nss.whks.de');
		expect(entries.map((x) => x.url)).toEqual([
			'https://nss.whks.de/',
			'https://nss.whks.de/hotnews',
			'https://nss.whks.de/rankings',
			'https://nss.whks.de/categories/visible',
			'https://nss.whks.de/tags/a-b',
			'https://nss.whks.de/sites/public-site',
			'https://nss.whks.de/bulletins/news'
		]);
		expect(
			entries.some(
				(x) => x.url.includes('draft') || x.url.includes('private') || x.url.includes('hidden')
			)
		).toBe(false);
	});
	it('renders valid escaped XML and normalized lastmod', async () => {
		const xml = buildSitemapXml([
			{ url: 'https://nss.whks.de/tags/a&b', lastmod: '2026-07-03 00:00:00' }
		]);
		expect(xml).toContain('<loc>https://nss.whks.de/tags/a&amp;b</loc>');
		expect(xml).toContain('<lastmod>2026-07-03T00:00:00.000Z</lastmod>');
		expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
	});
});
