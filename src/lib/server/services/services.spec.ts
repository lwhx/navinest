import { describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { listCategories } from '$lib/server/services/categories';
import { listItems } from '$lib/server/services/items';
import { listSearchEngines } from '$lib/server/services/search-engines';
import { listTags } from '$lib/server/services/tags';

function createDatabase(rows: unknown[]) {
	const calls: Array<{ query: string; values: DatabaseValue[] }> = [];
	const database: Database = {
		prepare(query) {
			const call = { query, values: [] as DatabaseValue[] };
			calls.push(call);

			const statement: DatabaseStatement = {
				bind(...values) {
					call.values = values;
					return statement;
				},
				async all<T>() {
					return { results: rows as T[] };
				}
			};

			return statement;
		}
	};

	return { database, calls };
}

describe('content query services', () => {
	it('maps visible categories and applies a type filter', async () => {
		const { database, calls } = createDatabase([
			{
				id: 1,
				type: 'site',
				parent_id: null,
				name: '开发工具',
				slug: 'dev-tools',
				icon: 'code',
				description: null,
				sort_order: 20,
				is_visible: 1,
				created_at: '2026-07-12',
				updated_at: '2026-07-12'
			}
		]);

		const categories = await listCategories(database, { type: 'site' });

		expect(categories[0]).toMatchObject({ name: '开发工具', isVisible: true, sortOrder: 20 });
		expect(calls[0].values).toEqual(['site']);
		expect(calls[0].query).toContain('is_visible = 1');
	});

	it('maps item relations, tags and metadata', async () => {
		const { database, calls } = createDatabase([
			{
				id: 2,
				type: 'site',
				category_id: 1,
				author_id: null,
				title: 'GitHub',
				slug: 'github',
				summary: '代码托管',
				content: null,
				cover_file_id: null,
				icon_file_id: null,
				status: 'published',
				visibility: 'public',
				sort_order: 20,
				is_featured: 1,
				published_at: '2026-07-12',
				created_at: '2026-07-12',
				updated_at: '2026-07-12',
				category_name: '开发工具',
				category_slug: 'dev-tools',
				tag_entries: `dev${String.fromCharCode(30)}开发${String.fromCharCode(31)}cloudflare${String.fromCharCode(30)}Cloudflare`,
				meta_entries: `site_url${String.fromCharCode(30)}https://github.com`
			}
		]);

		const items = await listItems(database, {
			tagSlug: 'dev',
			search: 'Git_100%',
			limit: 500,
			offset: -1
		});

		expect(items[0]).toMatchObject({
			title: 'GitHub',
			isFeatured: true,
			category: { slug: 'dev-tools' },
			tags: [
				{ name: '开发', slug: 'dev' },
				{ name: 'Cloudflare', slug: 'cloudflare' }
			],
			meta: { site_url: 'https://github.com' }
		});
		expect(calls[0].values).toEqual([
			'public',
			'published',
			'dev',
			'%Git\\_100\\%%',
			'%Git\\_100\\%%',
			100,
			0
		]);
		expect(calls[0].query).toContain('filter_tag.slug = ?');
	});

	it('maps tags and applies an optional content type', async () => {
		const { database, calls } = createDatabase([
			{
				id: 2,
				type: 'site',
				name: '开发',
				slug: 'dev',
				description: '开发工具',
				created_at: '2026-07-12',
				updated_at: '2026-07-12'
			}
		]);

		const tags = await listTags(database, 'site');

		expect(tags[0]).toMatchObject({ name: '开发', slug: 'dev', type: 'site' });
		expect(calls[0].values).toEqual(['site']);
	});

	it('maps enabled search engines in display order', async () => {
		const { database, calls } = createDatabase([
			{
				id: 1,
				group_key: 'onsite',
				name: '站内',
				key: 'site',
				url_template: '/search?q={query}',
				placeholder: '搜索 NaviNest',
				sort_order: 10,
				is_enabled: 1
			}
		]);

		const engines = await listSearchEngines(database);

		expect(engines[0]).toMatchObject({
			groupKey: 'onsite',
			urlTemplate: '/search?q={query}',
			isEnabled: true
		});
		expect(calls[0].query).toContain('WHERE is_enabled = 1');
	});
});
