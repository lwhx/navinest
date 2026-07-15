import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	parseHotJson,
	parseHotRss,
	refreshEnabledHotSources,
	refreshHotSource
} from '$lib/server/services/hotnews';

const connections: DatabaseSync[] = [];
const publicDns = async () => ['93.184.216.34'];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE hot_sources(id INTEGER PRIMARY KEY,name TEXT,type TEXT,url TEXT,headers_json TEXT DEFAULT '{}',parser_json TEXT DEFAULT '{}',cache_ttl INTEGER DEFAULT 900,is_enabled INTEGER DEFAULT 1,last_fetch_at TEXT,last_success_at TEXT,last_error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE hot_items(id INTEGER PRIMARY KEY AUTOINCREMENT,source_id INTEGER,rank INTEGER,title TEXT,url TEXT,hot_value TEXT,extra_json TEXT DEFAULT '{}',fetched_at TEXT DEFAULT CURRENT_TIMESTAMP);INSERT INTO hot_sources(id,name,type,url,parser_json) VALUES(1,'JSON','json','https://example.com/data','{"itemsPath":"data.list","titleField":"name","urlField":"link","hotField":"score"}'),(2,'RSS','rss','https://example.com/feed','{}');INSERT INTO hot_items(source_id,rank,title,url) VALUES(1,1,'Old','https://old.example.com');`
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
	it('preserves RSSHub publication, author, category and content metadata', () => {
		const item = parseHotRss(
			`<?xml version="1.0"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title><![CDATA[热点一]]></title><link>https://example.com/hot-1</link><pubDate>Wed, 15 Jul 2026 01:00:00 GMT</pubDate><dc:creator><![CDATA[百度新闻]]></dc:creator><category>社会</category><content:encoded><![CDATA[<p>热点摘要</p>]]></content:encoded></item></channel></rss>`
		)[0];
		expect(item).toMatchObject({
			title: '热点一',
			extra: {
				description: '热点摘要',
				publishedAt: 'Wed, 15 Jul 2026 01:00:00 GMT',
				author: '百度新闻',
				categories: ['社会']
			}
		});
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
				),
			publicDns
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
			refreshHotSource(database, 1, async () => new Response('bad', { status: 502 }), publicDns)
		).rejects.toThrow();
		expect(sqlite.prepare('SELECT title FROM hot_items WHERE source_id=1').get()).toMatchObject({
			title: 'Old'
		});
		expect(sqlite.prepare('SELECT last_error FROM hot_sources WHERE id=1').get()).toMatchObject({
			last_error: '热榜请求失败：HTTP 502'
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
					}),
				publicDns
			)
		).rejects.toThrow();
		expect(sqlite.prepare('SELECT title FROM hot_items WHERE source_id=1').get()).toMatchObject({
			title: 'Old'
		});
	});
	it('rejects a feed hostname that resolves to a private address before fetching', async () => {
		const { database } = fixture();
		let fetched = false;
		await expect(
			refreshHotSource(
				database,
				1,
				async () => {
					fetched = true;
					return new Response('{}');
				},
				async () => ['127.0.0.1']
			)
		).rejects.toThrow(/私网|保留地址/);
		expect(fetched).toBe(false);
	});
	it('rejects oversized RSS responses before buffering the body', async () => {
		const { database } = fixture();
		await expect(
			refreshHotSource(
				database,
				2,
				async () =>
					new Response('small placeholder', {
						headers: { 'content-type': 'application/rss+xml', 'content-length': '3000000' }
					}),
				publicDns
			)
		).rejects.toThrow(/过大/);
	});
	it('follows validated public redirects', async () => {
		const { database } = fixture();
		let calls = 0;
		const result = await refreshHotSource(
			database,
			1,
			async (input) => {
				calls += 1;
				if (String(input) === 'https://example.com/data')
					return new Response(null, {
						status: 302,
						headers: { location: 'https://cdn.example.com/data' }
					});
				return new Response(
					JSON.stringify({
						data: { list: [{ name: 'Redirected', link: 'https://example.com/r' }] }
					})
				);
			},
			publicDns
		);
		expect(result).toEqual({ sourceId: 1, count: 1 });
		expect(calls).toBe(2);
	});
	it('refreshes only enabled sources whose cache interval has elapsed', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec(
			"UPDATE hot_sources SET last_success_at=CURRENT_TIMESTAMP,cache_ttl=3600 WHERE id=1; UPDATE hot_sources SET last_success_at='2020-01-01 00:00:00',cache_ttl=3600 WHERE id=2"
		);
		let calls = 0;
		const results = await refreshEnabledHotSources(
			database,
			async () => {
				calls += 1;
				return new Response(
					'<rss><channel><item><title>Due</title><link>https://example.com/due</link></item></channel></rss>'
				);
			},
			publicDns
		);
		expect(calls).toBe(1);
		expect(results).toMatchObject([
			{ ok: true, sourceId: 1, skipped: true },
			{ ok: true, sourceId: 2, count: 1 }
		]);
	});
});
