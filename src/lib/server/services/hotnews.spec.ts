import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	parseHotHtml,
	parseHotJson,
	parseHotRss,
	refreshEnabledHotSources,
	refreshHotSource,
	inspectHotSource
} from '$lib/server/services/hotnews';

import { listHotSources, updateHotSource, validateHotSourceInput } from './hot-sources';

const connections: DatabaseSync[] = [];
const publicDns = async () => ['93.184.216.34'];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE hot_sources(id INTEGER PRIMARY KEY,name TEXT,type TEXT,url TEXT,headers_json TEXT DEFAULT '{}',parser_json TEXT DEFAULT '{}',cache_ttl INTEGER DEFAULT 900,is_enabled INTEGER DEFAULT 1,last_fetch_at TEXT,last_success_at TEXT,last_error TEXT,refresh_token TEXT,refresh_started_at TEXT,slug TEXT DEFAULT '',description TEXT DEFAULT '',icon TEXT DEFAULT '热',accent_color TEXT DEFAULT '#e5484d',surface_color TEXT DEFAULT '#fff7f7',display_limit INTEGER DEFAULT 20,layout TEXT DEFAULT 'list',sort_order INTEGER DEFAULT 0,show_description INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE hot_items(id INTEGER PRIMARY KEY AUTOINCREMENT,source_id INTEGER,rank INTEGER,title TEXT,url TEXT,hot_value TEXT,extra_json TEXT DEFAULT '{}',fetched_at TEXT DEFAULT CURRENT_TIMESTAMP);INSERT INTO hot_sources(id,name,type,url,parser_json) VALUES(1,'JSON','json','https://example.com/data','{"itemsPath":"data.list","titleField":"name","urlField":"link","hotField":"score"}'),(2,'RSS','rss','https://example.com/feed','{}');INSERT INTO hot_items(source_id,rank,title,url) VALUES(1,1,'Old','https://old.example.com');`
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
	it('rejects overlapping refreshes and preserves the active lease', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec(
			"UPDATE hot_sources SET refresh_token='active',refresh_started_at=CURRENT_TIMESTAMP WHERE id=1"
		);
		let fetched = false;
		await expect(
			refreshHotSource(
				database,
				1,
				async () => {
					fetched = true;
					return new Response('{}');
				},
				publicDns
			)
		).rejects.toMatchObject({ status: 409 });
		expect(fetched).toBe(false);
		expect(sqlite.prepare('SELECT refresh_token FROM hot_sources WHERE id=1').get()).toEqual({
			refresh_token: 'active'
		});
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
	it('refreshes an HTML source into hot_items', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec(
			`INSERT INTO hot_sources(id,name,type,url,parser_json,cache_ttl,is_enabled) VALUES(3,'HTML','html','https://example.com/hot','{"itemSelector":"li.hot-item","hotSelector":".num","baseUrl":"https://example.com/hot"}',900,1)`
		);
		const result = await refreshHotSource(
			database,
			3,
			async () =>
				new Response(
					'<ul><li class="hot-item"><a href="/topic/1">头条 <em>事件</em></a><span class="num">3.2万</span></li></ul>'
				),
			publicDns
		);
		expect(result).toEqual({ sourceId: 3, count: 1 });
		expect(
			sqlite.prepare('SELECT rank,title,url,hot_value FROM hot_items WHERE source_id=3').all()
		).toMatchObject([
			{ rank: 1, title: '头条 事件', url: 'https://example.com/topic/1', hot_value: '3.2万' }
		]);
	});
});

describe('hot html parsing', () => {
	const page = `<div class="wrap"><ul class="hot-list">
		<li class="hot-item"><a href="/topic/1" class="title">话题一 &amp; 事件</a><span class="num">1.2万</span></li>
		<li class="hot-item"><span class="num">9千</span><a href="https://example.com/topic/2">话题二</a></li>
		<li class="hot-item"><a href="javascript:alert(1)">坏链接</a></li>
		<li class="hot-item"><a href="http://127.0.0.1/topic/4">内网目标</a></li>
		<li class="hot-item"><a href="/topic/5">重复 &nbsp;  空白</a></li>
	</ul></div>`;

	it('extracts items from class selectors with relative links and hot values', () => {
		expect(
			parseHotHtml(page, {
				itemSelector: 'li.hot-item',
				hotSelector: '.num',
				baseUrl: 'https://news.example.com/hot'
			})
		).toEqual([
			{
				rank: 1,
				title: '话题一 & 事件',
				url: 'https://news.example.com/topic/1',
				hotValue: '1.2万',
				extra: {}
			},
			{
				rank: 2,
				title: '话题二',
				url: 'https://example.com/topic/2',
				hotValue: '9千',
				extra: {}
			},
			{
				rank: 3,
				title: '重复 空白',
				url: 'https://news.example.com/topic/5',
				hotValue: null,
				extra: {}
			}
		]);
	});
	it('supports classless class selectors and bare tag selectors', () => {
		const rows = `<div class="row"><a href="https://example.com/a">A</a></div><div class="row"><a href="https://example.com/b">B</a></div>`;
		expect(parseHotHtml(rows, { itemSelector: '.row' }).map((item) => item.title)).toEqual([
			'A',
			'B'
		]);
		expect(
			parseHotHtml('<span><a href="https://example.com/c">C</a></span>', {
				itemSelector: 'span'
			})
		).toMatchObject([{ rank: 1, title: 'C', url: 'https://example.com/c' }]);
	});
	it('honours a title selector that points at the anchor', () => {
		const html = `<li class="row"><a class="nav" href="https://example.com/nav">导航</a><a class="topic" href="https://example.com/topic">真题</a></li>`;
		expect(parseHotHtml(html, { itemSelector: 'li.row', titleSelector: 'a.topic' })).toMatchObject([
			{ title: '真题', url: 'https://example.com/topic' }
		]);
	});
	it('drops items without a usable link and rejects unusable input', () => {
		expect(() =>
			parseHotHtml('<li class="row">没有链接的条目</li>', { itemSelector: 'li.row' })
		).toThrow('HTML 页面未解析到有效条目。');
		expect(() => parseHotHtml(page)).toThrow('请先配置 HTML 条目选择器。');
		expect(() => parseHotHtml(page, { itemSelector: 'li[' })).toThrow('HTML 选择器格式无效');
		expect(() => parseHotHtml('<p>没有条目</p>', { itemSelector: 'li.row' })).toThrow(
			'HTML 页面未解析到有效条目。'
		);
	});
	it('caps the parsed list at 100 entries', () => {
		const many = Array.from(
			{ length: 130 },
			(_, index) => `<li class="row"><a href="https://example.com/${index}">第${index}条</a></li>`
		).join('');
		const items = parseHotHtml(many, { itemSelector: 'li.row' });
		expect(items).toHaveLength(100);
		expect(items.at(-1)).toMatchObject({ rank: 100, url: 'https://example.com/99' });
	});
});

describe('hot inspection and snapshot boundaries', () => {
	const fresh = () =>
		new Response(
			JSON.stringify({ data: { list: [{ name: 'Fresh', link: 'https://example.com/fresh' }] } })
		);
	it('previews configured parsing without acquiring a lease or touching database state', async () => {
		const { database, sqlite } = fixture();
		const before = sqlite.prepare('SELECT * FROM hot_sources').all();
		const preview = await inspectHotSource(
			{
				type: 'json',
				url: 'https://example.com/data',
				headers: {},
				parser: { itemsPath: 'data.list', titleField: 'name', urlField: 'link' }
			},
			async () => fresh(),
			publicDns
		);
		expect(preview).toMatchObject({
			count: 1,
			items: [{ title: 'Fresh' }],
			checkedAt: expect.any(String)
		});
		expect(sqlite.prepare('SELECT * FROM hot_sources').all()).toEqual(before);
		expect((await listHotSources(database))[0].itemCount).toBe(1);
	});
	it('bounds a hundred-item snapshot to four atomic statements', async () => {
		const { database, sqlite } = fixture();
		const batch = database.batch.bind(database);
		let statements = 0;
		database.batch = async (items) => {
			statements = items.length;
			await batch(items);
		};
		await refreshHotSource(
			database,
			1,
			async () =>
				new Response(
					JSON.stringify({
						data: {
							list: Array.from({ length: 100 }, (_, i) => ({
								name: 'Item ' + i,
								link: 'https://example.com/' + i
							}))
						}
					})
				),
			publicDns
		);
		expect(statements).toBe(4);
		expect(
			sqlite.prepare('SELECT COUNT(*) n,MAX(rank) rank FROM hot_items WHERE source_id=1').get()
		).toEqual({ n: 100, rank: 100 });
	});
	it('rolls back deletion and success markers if a later cache insert fails', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec(
			"UPDATE hot_sources SET last_success_at='2026-01-01T00:00:00Z' WHERE id=1; CREATE TRIGGER reject_cache BEFORE INSERT ON hot_items BEGIN SELECT RAISE(ABORT,'injected storage failure'); END"
		);
		await expect(refreshHotSource(database, 1, async () => fresh(), publicDns)).rejects.toThrow(
			'injected'
		);
		expect(sqlite.prepare('SELECT title FROM hot_items WHERE source_id=1').get()).toEqual({
			title: 'Old'
		});
		expect(
			sqlite
				.prepare('SELECT last_success_at,refresh_token,last_fetch_at FROM hot_sources WHERE id=1')
				.get()
		).toEqual({
			last_success_at: '2026-01-01T00:00:00Z',
			refresh_token: null,
			last_fetch_at: expect.any(String)
		});
	});
	it.each(['url', 'lease'])(
		'rejects a late %s change without overwriting another snapshot',
		async (field) => {
			const { database, sqlite } = fixture();
			await expect(
				refreshHotSource(
					database,
					1,
					async () => {
						sqlite.exec(
							field === 'url'
								? "UPDATE hot_sources SET url='https://example.com/changed',refresh_token=NULL WHERE id=1"
								: "UPDATE hot_sources SET refresh_token='new-owner' WHERE id=1"
						);
						return fresh();
					},
					publicDns
				)
			).rejects.toMatchObject({ status: 409 });
			expect(sqlite.prepare('SELECT title FROM hot_items WHERE source_id=1').get()).toEqual({
				title: 'Old'
			});
			expect(
				sqlite
					.prepare('SELECT refresh_token,last_error,last_success_at FROM hot_sources WHERE id=1')
					.get()
			).toEqual({
				refresh_token: field === 'url' ? null : 'new-owner',
				last_error: null,
				last_success_at: null
			});
		}
	);
	it('lists and diagnoses malformed stored configuration without fetching or losing old items', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec("UPDATE hot_sources SET parser_json='{' WHERE id=1");
		let fetched = false;
		expect((await listHotSources(database))[0]).toMatchObject({
			configInvalid: true,
			parserJson: '{',
			itemCount: 1
		});
		await expect(
			refreshHotSource(
				database,
				1,
				async () => {
					fetched = true;
					return fresh();
				},
				publicDns
			)
		).rejects.toMatchObject({ code: 'configuration' });
		expect(fetched).toBe(false);
		expect(sqlite.prepare('SELECT title FROM hot_items WHERE source_id=1').get()).toEqual({
			title: 'Old'
		});
	});
	it('resets verification only for retrieval changes and preserves the old cache', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec(
			"UPDATE hot_sources SET last_success_at='2026-01-01T00:00:00Z',last_error='HTTP 502' WHERE id=1"
		);
		const validation = validateHotSourceInput({
			name: 'JSON',
			slug: 'json',
			type: 'json',
			url: 'https://example.com/data',
			headersJson: '{}',
			parserJson:
				'{"itemsPath":"data.list","titleField":"name","urlField":"link","hotField":"score"}',
			isEnabled: true
		});
		if (!validation.valid) throw new Error('Invalid fixture');
		await updateHotSource(database, 1, { ...validation.data, name: 'Renamed' });
		expect(
			sqlite.prepare('SELECT last_success_at,last_error FROM hot_sources WHERE id=1').get()
		).toEqual({ last_success_at: '2026-01-01T00:00:00Z', last_error: 'HTTP 502' });
		await updateHotSource(database, 1, { ...validation.data, url: 'https://example.com/new' });
		expect(
			sqlite.prepare('SELECT last_success_at,last_error FROM hot_sources WHERE id=1').get()
		).toEqual({ last_success_at: null, last_error: null });
		expect(sqlite.prepare('SELECT title FROM hot_items WHERE source_id=1').get()).toEqual({
			title: 'Old'
		});
	});
	it('distinguishes an HTML error page, HTTP errors and a capped stream', async () => {
		const input = { type: 'rss', url: 'https://example.com/feed', headers: {}, parser: {} };
		await expect(
			inspectHotSource(
				input,
				async () => new Response('<!doctype html><title>Unavailable</title>'),
				publicDns
			)
		).rejects.toMatchObject({ code: 'parse' });
		await expect(
			inspectHotSource(input, async () => new Response('', { status: 503 }), publicDns)
		).rejects.toMatchObject({ code: 'http' });
		await expect(
			inspectHotSource(
				input,
				async () =>
					new Response(
						new ReadableStream({
							start(c) {
								c.enqueue(new Uint8Array(2097153));
								c.close();
							}
						})
					),
				publicDns
			)
		).rejects.toMatchObject({ code: 'too_large' });
	});
});
