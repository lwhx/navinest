import { describe, expect, it } from 'vitest';
import { buildHomeModulePlan } from '$lib/server/services/home-module-plan';
const sections = [
	{ slug: 'favorites', name: '常用推荐' },
	{ slug: 'dev-tools', name: '开发工具' },
	{ slug: 'design', name: '设计资源' }
];
describe('home module plan', () => {
	it('respects configured order and appends unconfigured categories', () => {
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
			'ranking:3',
			'content:favorites',
			'content:design'
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
