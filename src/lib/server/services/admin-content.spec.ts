import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { adminContentFilters, adminContentUrl } from '$lib/admin-content';
import { loadAdminContent, bulkUpdateAdminContent } from './admin-content';
import { loadAdminOverview } from './admin-data';
import { validateHomeModuleInput } from '$lib/server/admin-validation';
import { load as loadPage } from '../../../routes/admin/items/+page.server';
import { PATCH } from '../../../routes/api/admin/items/bulk/+server';

const connections: DatabaseSync[] = [];
function fixture(count = 123) {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
	sqlite.exec(readFileSync('migrations/0008_cron_health.sql', 'utf8'));
	sqlite.exec(readFileSync('migrations/0012_hot_board_customization.sql', 'utf8'));
	sqlite.exec(
		"INSERT INTO categories(id,type,name,slug) VALUES(1,'site','开发工具','tools'),(2,'app','软件','apps'); INSERT INTO tags(id,type,name,slug) VALUES(1,'site','协作标签','collaboration'); INSERT INTO users(id,username,display_name) VALUES(1,'admin','管理测试');"
	);
	const insert = sqlite.prepare(
		'INSERT INTO items(id,type,category_id,title,slug,summary,status,visibility,sort_order) VALUES(?,?,?,?,?,?,?,?,?)'
	);
	for (let id = 1; id <= count; id++)
		insert.run(
			id,
			'site',
			1,
			'资源 ' + id,
			'resource-' + id,
			'用途',
			id <= 100 ? 'published' : 'draft',
			id % 3 ? 'public' : 'private',
			id * 10
		);
	sqlite.exec(
		"INSERT INTO item_tags VALUES(1,1); INSERT INTO item_meta(item_id,meta_key,meta_value) VALUES(1,'site_url','https://example.com');"
	);
	const database: Database = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement: DatabaseStatement = {
				bind(...next) {
					if (next.length > 100) throw new Error('D1 bound parameter limit exceeded.');
					values = next;
					return statement;
				},
				async all<T>() {
					return {
						results: sqlite
							.prepare(query)
							.all(
								...values.map((value) =>
									value instanceof ArrayBuffer ? new Uint8Array(value) : value
								)
							) as T[]
					};
				}
			};
			return statement;
		}
	};
	return { database, sqlite };
}
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('administrator content library', () => {
	it('reaches records beyond the former 100-row limit and reports complete statistics', async () => {
		const { database } = fixture();
		const pages = await Promise.all(
			[1, 2, 3].map((page) =>
				loadAdminContent(database, new URLSearchParams({ page: String(page) }))
			)
		);
		expect(pages.map((page) => page.items.length)).toEqual([50, 50, 23]);
		expect(new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size).toBe(123);
		expect(pages[2].summary).toMatchObject({
			total: 123,
			published: 100,
			draft: 23,
			private: 41,
			types: { site: 123 }
		});
		expect(pages[2].total).toBe(123);
	});
	it('searches the whole library, including slugs, categories and tags without duplicate rows', async () => {
		const { database } = fixture();
		for (const [q, total] of [
			['resource-123', 1],
			['开发工具', 123],
			['协作标签', 1]
		] as const) {
			const result = await loadAdminContent(database, new URLSearchParams({ q }));
			expect(result.total).toBe(total);
		}
		const result = await loadAdminContent(database, new URLSearchParams({ q: 'resource-123' }));
		expect(result.items[0]).toMatchObject({ id: 123, status: 'draft', visibility: 'private' });
	});
	it('treats LIKE wildcards and SQL text as literal searches', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec("UPDATE items SET title='100%_资源' WHERE id=123");
		expect(
			(await loadAdminContent(database, new URLSearchParams({ q: '%_' }))).items.map(
				(item) => item.id
			)
		).toEqual([123]);
		expect(
			(await loadAdminContent(database, new URLSearchParams({ q: "' OR 1=1 --" }))).total
		).toBe(0);
	});
	it('combines filters, supports unclassified content and clamps out-of-range pages', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec('UPDATE items SET category_id=NULL WHERE id=123');
		const result = await loadAdminContent(
			database,
			new URLSearchParams({
				type: 'site',
				status: 'draft',
				visibility: 'private',
				category: 'none',
				page: '999'
			})
		);
		expect(result.items.map((item) => item.id)).toEqual([123]);
		expect(result.filters.page).toBe(1);
		expect(
			(await loadAdminContent(database, new URLSearchParams({ page: '999' }))).filters.page
		).toBe(3);
		expect((await loadAdminContent(database, new URLSearchParams({ type: 'app' }))).total).toBe(0);
	});
	it('loads an entire category for sorting, including drafts/private content, with an explicit large-category boundary', async () => {
		const { database } = fixture();
		const result = await loadAdminContent(
			database,
			new URLSearchParams({
				mode: 'sort',
				type: 'site',
				category: '1',
				q: 'irrelevant',
				status: 'published',
				visibility: 'public',
				page: '3'
			})
		);
		expect(result.items).toHaveLength(123);
		expect(result.orderComplete).toBe(true);
		expect(result.filters).toMatchObject({
			mode: 'sort',
			q: '',
			status: 'all',
			visibility: 'all',
			page: 1
		});
		const big = fixture(501);
		const limited = await loadAdminContent(
			big.database,
			new URLSearchParams({ mode: 'sort', type: 'site', category: '1' })
		);
		expect(limited.orderComplete).toBe(false);
		expect(limited.total).toBe(501);
		expect(limited.items).toHaveLength(50);
	});
	it('opens a deep-linked editor outside the current page and distinguishes database failures from sample data', async () => {
		const { database } = fixture();
		const data = await loadPage({
			platform: { env: { DB: database } },
			url: new URL('http://localhost/admin/items?edit=123')
		} as never);
		expect(data).toMatchObject({ editing: { id: 123, status: 'draft' }, source: 'database' });
		await expect(
			loadPage({
				platform: {
					env: {
						DB: {
							prepare() {
								throw new Error('offline');
							}
						}
					}
				},
				url: new URL('http://localhost/admin/items')
			} as never)
		).rejects.toMatchObject({ status: 503 });
	});
	it('normalizes unsafe query parameters and round-trips Chinese search/filter URLs', () => {
		expect(
			adminContentFilters(
				new URLSearchParams(
					'type=invalid&category=1e2&status=invalid&visibility=invalid&page=Infinity'
				)
			)
		).toMatchObject({ type: 'all', category: 'all', status: 'all', visibility: 'all', page: 1 });
		const filters = adminContentFilters(
			new URLSearchParams({
				q: ' 中文 & 协作 ',
				type: 'site',
				category: '1',
				status: 'draft',
				page: '2'
			})
		);
		expect(
			adminContentFilters(new URL(adminContentUrl(filters), 'https://example.test').searchParams)
		).toEqual(filters);
		expect(adminContentUrl(filters, { page: 1 })).not.toContain('page=');
	});
});

describe('administrator bulk content operations', () => {
	it('supports a full 50-item page within D1 parameter limits', async () => {
		const { database, sqlite } = fixture();
		const ids = Array.from({ length: 50 }, (_, index) => index + 1);
		expect(await bulkUpdateAdminContent(database, { ids, action: 'feature' })).toEqual({
			count: 50
		});
		expect(sqlite.prepare('SELECT COUNT(*) AS count FROM items WHERE is_featured=1').get()).toEqual(
			{ count: 50 }
		);
	});
	it('changes only selected records and preserves visibility, relations and other content fields', async () => {
		const { database, sqlite } = fixture();
		expect(await bulkUpdateAdminContent(database, { ids: [1, 123], action: 'draft' })).toEqual({
			count: 2
		});
		expect(
			sqlite.prepare('SELECT status,visibility,category_id,summary FROM items WHERE id=1').get()
		).toEqual({ status: 'draft', visibility: 'public', category_id: 1, summary: '用途' });
		expect(sqlite.prepare('SELECT status FROM items WHERE id=2').get()).toEqual({
			status: 'published'
		});
		expect(sqlite.prepare('SELECT COUNT(*) AS count FROM item_tags WHERE item_id=1').get()).toEqual(
			{ count: 1 }
		);
		expect(sqlite.prepare('SELECT meta_value FROM item_meta WHERE item_id=1').get()).toEqual({
			meta_value: 'https://example.com'
		});
		await bulkUpdateAdminContent(database, { ids: [123], action: 'publish' });
		expect(
			sqlite.prepare('SELECT status,visibility,published_at FROM items WHERE id=123').get()
		).toMatchObject({
			status: 'published',
			visibility: 'private',
			published_at: expect.any(String)
		});
		await bulkUpdateAdminContent(database, { ids: [123], action: 'feature' });
		expect(sqlite.prepare('SELECT is_featured FROM items WHERE id=123').get()).toEqual({
			is_featured: 1
		});
		await bulkUpdateAdminContent(database, { ids: [123], action: 'unfeature' });
		expect(sqlite.prepare('SELECT is_featured FROM items WHERE id=123').get()).toEqual({
			is_featured: 0
		});
	});
	it('rejects stale selections atomically instead of updating the surviving subset', async () => {
		const { database, sqlite } = fixture();
		await expect(
			bulkUpdateAdminContent(database, { ids: [1, 999], action: 'draft' })
		).rejects.toMatchObject({ status: 409 });
		expect(sqlite.prepare('SELECT status FROM items WHERE id=1').get()).toEqual({
			status: 'published'
		});
	});
	it('rejects empty, duplicate, oversized and non-numeric selections and unsupported actions', async () => {
		const { database } = fixture();
		for (const ids of [
			[],
			[1, 1],
			['1'],
			[true],
			[0],
			[-1],
			[1.5],
			Array.from({ length: 51 }, (_, i) => i + 1)
		])
			await expect(
				bulkUpdateAdminContent(database, { ids, action: 'publish' })
			).rejects.toMatchObject({ status: 400 });
		await expect(
			bulkUpdateAdminContent(database, { ids: [1], action: 'delete' })
		).rejects.toMatchObject({ status: 400 });
	});
	it('uses the route error contract for invalid JSON, unavailable databases and valid updates', async () => {
		const { database } = fixture();
		const invoke = (body: string, db: Database | undefined = database) =>
			PATCH({
				platform: { env: { DB: db } },
				request: new Request('http://localhost/api/admin/items/bulk', { method: 'PATCH', body })
			} as never);
		expect((await invoke('[')).status).toBe(400);
		expect(
			(
				await PATCH({
					platform: undefined,
					request: new Request('http://localhost/api/admin/items/bulk', {
						method: 'PATCH',
						body: '{}'
					})
				} as never)
			).status
		).toBe(503);
		expect(await (await invoke(JSON.stringify({ ids: [1], action: 'feature' }))).json()).toEqual({
			count: 1
		});
	});
});

describe('administrator workbench and homepage configuration', () => {
	it('counts pending submissions rather than review history and exposes recent items and health accurately', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO submissions(user_id,type,title,payload_json,status) VALUES(1,'site','待审核','{}','pending'),(1,'site','已通过','{}','approved'),(1,'site','已拒绝','{}','rejected'); INSERT INTO hot_sources(name,type,url,slug,last_error) VALUES('失败源','rss','https://example.com','broken','network'); INSERT INTO cron_runs(cron,scheduled_at,status) VALUES('* * * * *','2026-10-12','partial');"
		);
		const result = await loadAdminOverview(database);
		expect(result.submissions).toBe(1);
		expect(result.recent).toHaveLength(6);
		expect(result.recent[0].id).toBe(123);
		expect(result.health).toMatchObject({
			hotErrors: 1,
			lastRun: { status: 'partial' },
			cronAvailable: true
		});
	});
	it('marks optional health data unavailable instead of treating it as a healthy zero', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec('DROP TABLE cron_runs; ALTER TABLE hot_sources DROP COLUMN last_error;');
		expect((await loadAdminOverview(database)).health).toEqual({
			hotErrors: null,
			lastRun: null,
			cronAvailable: false
		});
	});
	it('dedicated category selection overrides only its key and leaves extension configuration intact', () => {
		expect(
			validateHomeModuleInput({
				type: 'content',
				title: '常用推荐',
				configJson: '{"categorySlug":"old","columns":4,"custom":{"keep":true}}',
				categorySlug: 'tools',
				sortOrder: 42,
				isEnabled: false
			})
		).toMatchObject({
			valid: true,
			data: {
				config: { categorySlug: 'tools', columns: 4, custom: { keep: true } },
				sortOrder: 42,
				isEnabled: false
			}
		});
		expect(
			validateHomeModuleInput({
				type: 'content',
				title: '分类资源',
				configJson: '{}',
				categorySlug: ''
			})
		).toMatchObject({ valid: false, errors: { categorySlug: expect.any(String) } });
	});
});
