import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { parseHotJson, parseHotRss, refreshHotSource } from '$lib/server/services/hotnews';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE hot_sources(id INTEGER PRIMARY KEY,name TEXT,type TEXT,url TEXT,headers_json TEXT DEFAULT '{}',parser_json TEXT DEFAULT '{}',cache_ttl INTEGER DEFAULT 900,is_enabled INTEGER DEFAULT 1,last_fetch_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE hot_items(id INTEGER PRIMARY KEY AUTOINCREMENT,source_id INTEGER,rank INTEGER,title TEXT,url TEXT,hot_value TEXT,extra_json TEXT DEFAULT '{}',fetched_at TEXT DEFAULT CURRENT_TIMESTAMP);INSERT INTO hot_sources(id,name,type,url,parser_json) VALUES(1,'JSON','json','https://example.com/data','{"itemsPath":"data.list","titleField":"name","urlField":"link","hotField":"score"}'),(2,'RSS','rss','https://example.com/feed','{}');INSERT INTO hot_items(source_id,rank,title,url) VALUES(1,1,'Old','https://old.example.com');`
	);
	const database: Database & { batch(s: DatabaseStatement[]): Promise<void> } = {
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
	return { sqlite, database };
}
afterEach(() => connections.splice(0).forEach((x) => x.close()));

describe('hot news parsers', () => {
	it('maps configured JSON paths and drops unsafe entries', () => {
		expect(
			parseHotJson(
				{
					data: {
						list: [
							{ name: 'One', link: 'https://example.com/1', score: 99 },
							{ name: 'Local', link: 'http://127.0.0.1' }
						]
					}
				},
				{ itemsPath: 'data.list', titleField: 'name', urlField: 'link', hotField: 'score' }
			)
		).toEqual([{ rank: 1, title: 'One', url: 'https://example.com/1', hotValue: '99', extra: {} }]);
	});
	it('parses RSS 2.0 and Atom feeds', () => {
		expect(
			parseHotRss(
				`<?xml version="1.0"?><rss><channel><item><title>RSS One</title><link>https://example.com/rss</link><description>Hot</description></item></channel></rss>`
			)[0]
		).toMatchObject({ title: 'RSS One', url: 'https://example.com/rss' });
		expect(
			parseHotRss(
				`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom One</title><link href="https://example.com/atom"/><summary>Summary</summary></entry></feed>`
			)[0]
		).toMatchObject({ title: 'Atom One', url: 'https://example.com/atom' });
	});
});

describe('hot source refresh', () => {
	it('replaces a source snapshot only after successful parsing', async () => {
		const { database, sqlite } = fixture();
		const result = await refreshHotSource(
			database,
			1,
			async () =>
				new Response(
					JSON.stringify({
						data: { list: [{ name: 'Fresh', link: 'https://example.com/fresh', score: '1k' }] }
					}),
					{ headers: { 'content-type': 'application/json' } }
				)
		);
		expect(result).toEqual({ sourceId: 1, count: 1 });
		expect(
			sqlite.prepare('SELECT rank,title,url,hot_value FROM hot_items WHERE source_id=1').all()
		).toMatchObject([
			{ rank: 1, title: 'Fresh', url: 'https://example.com/fresh', hot_value: '1k' }
		]);
	});
	it('preserves the previous snapshot when fetching or parsing fails', async () => {
		const { database, sqlite } = fixture();
		await expect(
			refreshHotSource(database, 1, async () => new Response('bad', { status: 502 }))
		).rejects.toThrow();
		expect(sqlite.prepare('SELECT title FROM hot_items WHERE source_id=1').get()).toMatchObject({
			title: 'Old'
		});
	});
	it('rejects redirects to private network targets', async () => {
		const { database, sqlite } = fixture();
		await expect(
			refreshHotSource(
				database,
				1,
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: 'http://127.0.0.1/feed' }
					})
			)
		).rejects.toThrow();
		expect(sqlite.prepare('SELECT title FROM hot_items WHERE source_id=1').get()).toMatchObject({
			title: 'Old'
		});
	});
	it('follows validated public redirects', async () => {
		const { database } = fixture();
		let calls = 0;
		const result = await refreshHotSource(database, 1, async (input) => {
			calls += 1;
			if (String(input) === 'https://example.com/data')
				return new Response(null, {
					status: 302,
					headers: { location: 'https://cdn.example.com/data' }
				});
			return new Response(
				JSON.stringify({ data: { list: [{ name: 'Redirected', link: 'https://example.com/r' }] } })
			);
		});
		expect(result).toEqual({ sourceId: 1, count: 1 });
		expect(calls).toBe(2);
	});
});
