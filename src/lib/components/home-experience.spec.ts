import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/rankings'), data: { user: null } }
}));
import HomeModuleFlow from './HomeModuleFlow.svelte';
import NavigationCard from './NavigationCard.svelte';
import RankingsPage from '../../routes/rankings/+page.svelte';
import { SITE_SETTINGS_DEFAULTS } from '$lib/types/site';
import { fallbackHomeData } from '$lib/server/services/home';
import { navigationItems } from '$lib/data/navigation';

describe('homepage content rendering', () => {
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
			expect(body).toContain(`<small>${label}</small>`);
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
		expect(body).toContain('>文章</span>');
		expect(body).not.toContain('/go?url=');
	});
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
