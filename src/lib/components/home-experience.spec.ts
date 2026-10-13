import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { mockPage } = vi.hoisted(() => ({
	mockPage: { url: new URL('http://localhost/rankings'), data: { user: null } }
}));
vi.mock('$app/state', () => ({
	page: mockPage,
	navigating: { to: null }
}));
import HomeModuleFlow from './HomeModuleFlow.svelte';
import NavigationCard from './NavigationCard.svelte';
import RankingsPage from '../../routes/rankings/+page.svelte';
import HomePage from '../../routes/+page.svelte';
import { SITE_SETTINGS_DEFAULTS } from '$lib/types/site';
import { fallbackHomeData } from '$lib/server/services/home';
import { navigationItems } from '$lib/data/navigation';
import { contentDetailRoute } from '$lib/content-routing';
import type { ContentType } from '$lib/types/content';

afterEach(() => {
	mockPage.url = new URL('http://localhost/rankings');
});

function subcategoryHome() {
	const home = fallbackHomeData();
	const root = { ...navigationItems[0], slug: 'root-resource', title: '父级资源' };
	const child = { ...root, slug: 'child-resource', title: '子分类资源', category: '前端开发' };
	const grandchild = {
		...child,
		slug: 'grandchild-resource',
		title: '孙分类资源',
		category: '框架'
	};
	home.sections = [
		{
			...home.sections[0],
			slug: 'tools',
			children: [
				{ slug: 'frontend', name: '前端开发', icon: 'link' },
				{ slug: 'empty', name: '空分类', icon: 'link' }
			],
			items: [root, child, grandchild],
			itemsByChild: { frontend: [child, grandchild], empty: [] }
		}
	];
	home.modulePlan = [
		{ key: 'content:tools', type: 'content', title: '开发工具', categorySlug: 'tools' }
	];
	return home;
}

describe('homepage subcategory SSR', () => {
	it('renders the URL-selected child and its descendants before hydration, with native links', () => {
		mockPage.url = new URL('http://localhost/?sub.tools=frontend&source=share#tools');
		const { body } = render(HomePage, {
			props: { data: { ...subcategoryHome(), site: SITE_SETTINGS_DEFAULTS, user: null } }
		});
		expect(body).toContain('子分类资源');
		expect(body).toContain('孙分类资源');
		expect(body).not.toContain('父级资源');
		expect(body).toContain('data-sveltekit-preload-data="off"');
		expect(body).toMatch(/<a[^>]*href="\/\?source=share#tools"[^>]*aria-selected="false"/);
		expect(body).toMatch(
			/<a[^>]*href="\/\?sub.tools=frontend&amp;source=share#tools"[^>]*aria-selected="true"/
		);
	});
	it('renders empty children as empty rather than silently showing all parent items', () => {
		mockPage.url = new URL('http://localhost/?sub.tools=empty');
		const { body } = render(HomeModuleFlow, {
			props: { home: subcategoryHome(), mode: 'content' }
		});
		expect(body).toContain('此分类暂时没有内容');
		expect(body).not.toContain('父级资源');
		expect(body).not.toContain('子分类资源');
	});
	it('uses all public parent items when a child is no longer available', () => {
		mockPage.url = new URL('http://localhost/?sub.tools=deleted');
		const { body } = render(HomeModuleFlow, {
			props: { home: subcategoryHome(), mode: 'content' }
		});
		expect(body).toContain('父级资源');
		expect(body).toContain('子分类资源');
		expect(body).toMatch(/<a[^>]*href="\/#tools"[^>]*aria-selected="true"/);
	});
});

describe('homepage content rendering', () => {
	it('omits retired homepage anchors and sidebar entries in real page SSR', () => {
		const home = fallbackHomeData();
		const { body } = render(HomePage, {
			props: { data: { ...home, site: SITE_SETTINGS_DEFAULTS, user: null } }
		});
		for (const slug of ['bookshelf', 'notes', 'announcements']) {
			expect(body).not.toContain(`href="#${slug}"`);
			expect(body).not.toContain(`id="${slug}"`);
		}
		expect(body).toContain('href="#favorites"');
		expect(body).toContain('id="productivity"');
		expect(body).toContain('href="/posts/building-a-quiet-start-space"');
	});
	it('omits view and favorite counts from home cards while keeping ranked content reachable', () => {
		const home = fallbackHomeData();
		home.dashboard.popular[0].views = 123456789;
		home.dashboard.popular[0].favorites = 9876543;
		const { body } = render(HomeModuleFlow, { props: { home, mode: 'content' } });
		expect(body).not.toContain('class="card-metrics"');
		expect(body).not.toMatch(/(?:浏览|收藏) \d/);
		expect(body).toContain('href="/sites/cloudflare-dashboard"');
		expect(body).toContain('href="/rankings"');
		expect(body).toContain('class="card-summary"');
		expect(body).not.toContain('type-chip');
		expect(body).not.toContain('card-secondary');
	});
	it('makes the dense title and purpose one native detail target without nesting the visit link', () => {
		const item = navigationItems[0];
		const { body } = render(NavigationCard, { props: { item, dense: true, compact: true } });
		const detailTarget = body
			.match(/<a class="card-title-link card-body-link"[\s\S]*?<\/a>/)?.[0]
			?.replace(/<!--[\s\S]*?-->/g, '');
		expect(detailTarget).toContain(`href="/sites/${item.slug}"`);
		expect(detailTarget).toContain(`<h3>${item.title}</h3>`);
		expect(detailTarget).toContain('class="card-summary"');
		expect(detailTarget).not.toContain('/go?url=');
		expect(body).toContain('class="direct-link"');
		expect(body).toContain('rel="external noopener noreferrer"');
	});
	it('renders all five types on the independent ranking page through shared detail routes', () => {
		const home = fallbackHomeData();
		const { body } = render(RankingsPage, {
			props: {
				form: null,
				params: {},
				data: {
					site: SITE_SETTINGS_DEFAULTS,
					user: null,
					period: 'total',
					items: home.dashboard.popular.map((item) => ({ ...item, likes: 0 }))
				}
			}
		});
		for (const path of [
			'/sites/cloudflare-dashboard',
			'/posts/building-a-quiet-start-space',
			'/apps/visual-studio-code',
			'/books/design-of-everyday-things',
			'/bulletins/navinest-preview'
		])
			expect(body).toContain(`href="${path}"`);
		for (const label of ['网址', '文章', '软件', '书籍', '公告'])
			expect(body).not.toContain(`<small>${label}</small>`);
	});
	it('keeps a ranked item reachable even when it has no loaded category card', () => {
		const home = fallbackHomeData();
		home.sections = [];
		home.dashboard.popular = [
			{
				id: 1,
				type: 'post',
				slug: 'uncategorized-post',
				title: '未分类文章',
				views: 1,
				favorites: 0,
				score: 1
			}
		];
		home.modulePlan = [{ key: 'ranking:1', type: 'ranking', title: '排行' }];
		const { body } = render(HomeModuleFlow, { props: { home, mode: 'content' } });
		expect(body).toContain('href="/posts/uncategorized-post"');
		expect(body).toContain('未分类文章');
		expect(body).not.toContain('type-chip');
		expect(body).not.toContain('card-secondary');
		expect(body).not.toContain('/go?url=');
	});
	it.each<ContentType>(['site', 'post', 'app', 'book', 'bulletin'])(
		'removes the %s badge from both home and public cards while preserving detail routing',
		(type) => {
			const item = { ...navigationItems[0], type };
			for (const dense of [false, true]) {
				const { body } = render(NavigationCard, { props: { item, dense, compact: dense } });
				expect(body).not.toContain('type-chip');
				expect(body).not.toContain('card-secondary');
				expect(body).toContain(`href="${contentDetailRoute(type).replace('[slug]', item.slug)}"`);
				expect(body).toContain(item.summary);
				expect(body).toContain('rel="external noopener noreferrer"');
			}
		}
	);
	it('omits blank summaries and retains exact counts alongside compact visible metrics', () => {
		const { body } = render(NavigationCard, {
			props: {
				item: { ...navigationItems[0], summary: '  ' },
				compact: true,
				metrics: { views: 123456789, favorites: 9876543 }
			}
		});
		expect(body).not.toContain('class="card-summary"');
		expect(body).toContain('title="浏览 123456789"');
		expect(body).toContain('title="收藏 9876543"');
		expect(body).toContain('浏览 1.2亿');
		expect(body).toContain('收藏 987.7万');
		expect(body).toContain('target="_blank"');
		expect(body).toContain('/go?url=');
	});
	it('gives empty categories and lists a usable next action', () => {
		const home = fallbackHomeData();
		home.sections[0].items = [];
		home.dashboard.popular = [];
		home.modulePlan = [
			{ key: 'content:favorites', type: 'content', title: '推荐', categorySlug: 'favorites' },
			{ key: 'ranking:1', type: 'ranking', title: '排行' },
			{ key: 'hot:2', type: 'hot', title: '热点' }
		];
		const { body } = render(HomeModuleFlow, { props: { home, mode: 'content' } });
		expect(body).toContain('搜索其他资源');
		expect(body).toContain('暂无排行内容');
		expect(body).toContain('等待热点更新');
		expect(body).toContain('href="/hotnews"');
	});
});
