import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/search'), data: { user: null } },
	navigating: { to: null }
}));
import SearchPage from '../../routes/search/+page.svelte';
import AdminHomePage from '../../routes/admin/home-modules/+page.svelte';
import AdminLayout from '../../routes/admin/+layout.svelte';
import HomeModuleFlow from './HomeModuleFlow.svelte';
import ContentResults from './ContentResults.svelte';
import { SITE_SETTINGS_DEFAULTS } from '$lib/types/site';
import { fallbackHomeData } from '$lib/server/services/home';
import { navigationItems } from '$lib/data/navigation';
import { searchPageUrl } from '$lib/search';

const query = '中文资源 & 协作';
function searchFixture(page: number, total = 61) {
	const data = {
		site: SITE_SETTINGS_DEFAULTS,
		user: null,
		title: '“' + query + '”的搜索结果',
		description: '找到 ' + total + ' 条相关内容',
		query,
		total,
		page,
		pageCount: Math.ceil(total / 24),
		pageSize: 24,
		items: Array.from(
			{ length: Math.max(0, Math.min(24, total - (page - 1) * 24)) },
			(_, index) => ({
				...navigationItems[0],
				slug: 'search-' + ((page - 1) * 24 + index),
				title: '中文资源与团队协作 ' + ((page - 1) * 24 + index + 1)
			})
		),
		children: [],
		source: 'database' as const
	};
	return render(SearchPage, { props: { data, params: {}, form: null } }).body;
}
function adminFixture() {
	const editing = {
		id: 1,
		type: 'search' as const,
		title: '聚合搜索',
		config: { defaultGroup: 'onsite', recommendedSearches: ['团队协作', '设计资源'] },
		sortOrder: 10,
		isEnabled: true,
		createdAt: '',
		updatedAt: ''
	};
	const result = render(AdminHomePage, {
		props: {
			params: {},
			form: null,
			data: {
				site: SITE_SETTINGS_DEFAULTS,
				user: null,
				admin: {
					id: 1,
					email: 'admin@example.test',
					displayName: '本地测试',
					source: 'local' as const
				},
				source: 'database' as const,
				mode: 'edit',
				editing,
				modules: [editing],
				categories: []
			}
		}
	}).body;
	return render(AdminLayout, {
		props: {
			params: {},
			data: {
				site: SITE_SETTINGS_DEFAULTS,
				user: null,
				admin: {
					id: 1,
					email: 'admin@example.test',
					displayName: '本地测试',
					source: 'local' as const
				}
			},
			children: createRawSnippet(() => ({ render: () => '<div>' + result + '</div>' }))
		}
	}).body;
}

describe('search experience rendering', () => {
	it('shows the full result count and URL-based, accessible pagination', () => {
		const body = searchFixture(2);
		expect(body).toContain('<strong>61<small>条结果</small></strong>');
		expect(body.match(/class="site-card /g)).toHaveLength(24);
		const pagination = body.slice(body.indexOf('<nav class="search-pagination"'));
		expect(pagination).toContain('aria-label="搜索结果分页"');
		expect(pagination).toContain('第 2 / 3 页');
		expect(pagination).toContain('aria-current="page"');
		expect(pagination).toContain(searchPageUrl(query, 3).replaceAll('&', '&amp;'));
		expect(pagination).toContain('rel="prev"');
		expect(pagination).toContain('rel="next"');
	});
	it('hides unavailable page links and keeps long pagination compact', () => {
		const first = searchFixture(1).split('<nav class="search-pagination"')[1];
		const last = searchFixture(3).split('<nav class="search-pagination"')[1];
		expect(first).not.toContain('rel="prev"');
		expect(last).not.toContain('rel="next"');
		const middle = searchFixture(50, 2400).split('<nav class="search-pagination"')[1];
		expect(middle).toContain('pagination-gap');
		expect(middle).toContain('第 100 页');
		expect(middle.match(/aria-label="第 \d+ 页"/g)).toHaveLength(5);
	});
	it('does not create a pager for a single-page or empty search', () => {
		for (const total of [0, 1, 24])
			expect(searchFixture(1, total)).not.toContain('search-pagination');
	});
	it('renders repeated titles with their distinct content identity', () => {
		const items = [
			navigationItems[0],
			{ ...navigationItems[0], type: 'app' as const, slug: 'same-title' }
		];
		const { body } = render(ContentResults, { props: { items } });
		expect(body).toContain('/sites/' + items[0].slug);
		expect(body).toContain('/apps/same-title');
	});
	it('uses configured recommendations, escapes text and honors an empty list', () => {
		const home = fallbackHomeData();
		home.modulePlan[0].recommendedSearches = ['团队协作', '<script>alert(1)</script>'];
		let body = render(HomeModuleFlow, { props: { home, mode: 'hero' } }).body;
		expect(body).toContain('推荐搜索：');
		expect(body).toContain('团队协作');
		expect(body).not.toContain('<script>alert');
		expect(body).not.toContain('热门：');
		home.modulePlan[0].recommendedSearches = [];
		body = render(HomeModuleFlow, { props: { home, mode: 'hero' } }).body;
		expect(body).not.toContain('search-hotwords');
	});
	it('keeps an onsite search available when every configured engine is disabled', () => {
		const home = fallbackHomeData();
		home.searchEngines = [];
		const { body } = render(HomeModuleFlow, { props: { home, mode: 'hero' } });
		expect(body).toContain('action="/search"');
		expect(body).toContain('使用 站内 搜索');
	});
	it('offers a plain recommendation editor without rewriting other configuration', () => {
		const body = adminFixture();
		expect(body).toContain('name="recommendedSearchesText"');
		expect(body).toContain('团队协作\n设计资源');
		expect(body).toContain('defaultGroup');
		expect(body).toContain('留空隐藏推荐搜索');
	});
	it('emits actual SSR markup for browser layout and native pagination checks', () => {
		const home = fallbackHomeData();
		home.modulePlan[0].recommendedSearches = Array.from(
			{ length: 8 },
			(_, index) => '中文团队协作与资源查找推荐词' + (index + 1)
		);
		const fixtures = {
			query,
			search: [1, 2, 3].map((page) => searchFixture(page)),
			longSearch: searchFixture(50, 2400),
			recommendations: render(HomeModuleFlow, { props: { home, mode: 'hero' } }).body,
			admin: adminFixture(),
			adminStyles: [
				'admin-base.css',
				'admin-productization.css',
				'admin-content-workbench.css',
				'admin-content-ordering.css',
				'admin-content-modal.css',
				'admin-workspace.css'
			]
				.map((name) => readFileSync('src/routes/' + name, 'utf8'))
				.join('\n')
		};
		writeFileSync(join(tmpdir(), 'navinest-search-fixtures.json'), JSON.stringify(fixtures));
		expect(fixtures.search).toHaveLength(3);
	});
});
