import { describe, expect, it } from 'vitest';
import { buildHomeCategoryLinks } from '$lib/home-category-navigation';
import { fallbackHomeData } from '$lib/server/services/home';
import { buildHomeModulePlan } from '$lib/server/services/home-module-plan';
const sections = [
	{ slug: 'favorites', name: '常用推荐' },
	{ slug: 'dev-tools', name: '开发工具' },
	{ slug: 'design', name: '设计资源' }
];
describe('home module plan', () => {
	it('respects saved module order and fills categories before trailing rankings', () => {
		const plan = buildHomeModulePlan(
			[
				{
					id: 1,
					type: 'content',
					title: '开发工具',
					sortOrder: 10,
					config: { categorySlug: 'dev-tools' }
				},
				{ id: 2, type: 'search', title: '搜索', sortOrder: 20, config: {} },
				{ id: 3, type: 'ranking', title: '排行榜', sortOrder: 30, config: {} }
			],
			sections
		);
		expect(plan.map((x) => x.key)).toEqual([
			'content:dev-tools',
			'search:2',
			'content:favorites',
			'content:design',
			'ranking:3'
		]);
	});
	it('accepts safe links and never returns executable custom html', () => {
		const plan = buildHomeModulePlan(
			[
				{
					id: 4,
					type: 'links',
					title: '快捷入口',
					sortOrder: 1,
					config: {
						links: [
							{ label: 'Docs', url: 'https://example.com' },
							{ label: 'Bad', url: 'javascript:alert(1)' }
						]
					}
				},
				{
					id: 5,
					type: 'custom_html',
					title: 'HTML',
					sortOrder: 2,
					config: { html: '<script>alert(1)</script>' }
				}
			],
			[]
		);
		expect(plan[0]).toMatchObject({
			type: 'links',
			links: [{ label: 'Docs', url: 'https://example.com/' }]
		});
		expect(plan).toHaveLength(1);
		expect(JSON.stringify(plan)).not.toContain('<script>');
	});
});

describe('homepage module combinations', () => {
	it('keeps an explicitly saved ranking-first order and category navigation order', () => {
		const modules = [
			{ id: 1, type: 'ranking', title: '先看排行', sortOrder: 10, config: {} },
			{ id: 2, type: 'content', title: '设计', sortOrder: 20, config: { categorySlug: 'design' } },
			{
				id: 3,
				type: 'content',
				title: '开发',
				sortOrder: 30,
				config: { categorySlug: 'dev-tools' }
			}
		];
		const plan = buildHomeModulePlan(modules, sections);
		expect(plan.map((entry) => entry.key)).toEqual([
			'ranking:1',
			'content:design',
			'content:dev-tools',
			'content:favorites'
		]);
		expect(buildHomeCategoryLinks(plan, sections).map((entry) => entry.slug)).toEqual([
			'design',
			'dev-tools',
			'favorites'
		]);
	});
	it('renders only the first enabled ranking/hot dataset and never adds absent auxiliary modules', () => {
		const modules = [
			{ id: 1, type: 'ranking', title: '排行一', sortOrder: 10, config: {} },
			{ id: 2, type: 'hot', title: '热点一', sortOrder: 20, config: {} },
			{ id: 3, type: 'ranking', title: '排行二', sortOrder: 30, config: {} },
			{ id: 4, type: 'hot', title: '热点二', sortOrder: 40, config: {} }
		];
		expect(buildHomeModulePlan(modules, sections).map((entry) => entry.key)).toEqual([
			'content:favorites',
			'content:dev-tools',
			'content:design',
			'ranking:1',
			'hot:2'
		]);
		expect(buildHomeModulePlan([], []).length).toBe(0);
		expect(buildHomeModulePlan([], sections).every((entry) => entry.type === 'content')).toBe(true);
	});
	it('does not auto-fill disabled categories, but an explicit enabled module wins', () => {
		const plan = buildHomeModulePlan([], sections, ['favorites']);
		expect(plan.map((entry) => entry.categorySlug)).toEqual(['dev-tools', 'design']);
		expect(buildHomeCategoryLinks(plan, sections).map((entry) => entry.slug)).toEqual([
			'dev-tools',
			'design'
		]);
		const enabled = [
			{
				id: 1,
				type: 'content',
				title: '推荐',
				sortOrder: 10,
				config: { categorySlug: 'favorites' }
			}
		];
		expect(buildHomeModulePlan(enabled, sections, ['favorites'])[0].categorySlug).toBe('favorites');
	});
	it('defaults to search, common resources/categories, then the auxiliary ranking', () => {
		const home = fallbackHomeData();
		expect(home.modulePlan.map((entry) => entry.type)).toEqual([
			'search',
			...home.sections.map(() => 'content'),
			'ranking'
		]);
	});
});
