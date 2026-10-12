import { describe, expect, it } from 'vitest';
import { buildNavigationSections } from '$lib/server/services/home';
import type { Item } from '$lib/types/content';
function item(
	id: number,
	title: string,
	slug: string,
	category: { id: number; name: string; slug: string }
): Item {
	return {
		id,
		type: 'site',
		categoryId: category.id,
		authorId: null,
		title,
		slug,
		summary: '',
		content: '',
		coverFileId: null,
		iconFileId: null,
		status: 'published',
		visibility: 'public',
		sortOrder: id,
		isFeatured: false,
		publishedAt: null,
		createdAt: '',
		updatedAt: '',
		category,
		tags: [],
		meta: { site_url: `https://${slug}.example` }
	};
}
describe('home category tree sections', () => {
	it('includes deeper descendants in root and child branches without mixing same-named categories', () => {
		const categories = [
			{ id: 1, parentId: null, name: '开发工具', slug: 'tools', icon: 'code' },
			{ id: 2, parentId: 1, name: '同名分类', slug: 'frontend', icon: 'code' },
			{ id: 3, parentId: 2, name: '框架资源', slug: 'frameworks', icon: 'code' },
			{ id: 4, parentId: 1, name: '同名分类', slug: 'collaboration', icon: 'code' }
		];
		const items = categories.map((category) =>
			item(category.id, category.slug, category.slug, category)
		);
		const section = buildNavigationSections(categories, items)[0];
		expect(section.items.map((item) => item.slug)).toEqual([
			'tools',
			'frontend',
			'frameworks',
			'collaboration'
		]);
		expect(section.children.map((category) => category.slug)).toEqual([
			'frontend',
			'collaboration'
		]);
		expect(section.itemsByChild?.frontend.map((item) => item.slug)).toEqual([
			'frontend',
			'frameworks'
		]);
		expect(section.itemsByChild?.collaboration.map((item) => item.slug)).toEqual(['collaboration']);
	});
	it('includes child category items in their parent section', () => {
		const categories = [
				{ id: 1, parentId: null, name: '开发工具', slug: 'dev-tools', icon: 'code' },
				{ id: 2, parentId: 1, name: '前端开发', slug: 'frontend-dev', icon: 'code' }
			],
			items = [
				item(1, 'GitHub', 'github', { id: 1, name: '开发工具', slug: 'dev-tools' }),
				item(2, 'Vite', 'vite', { id: 2, name: '前端开发', slug: 'frontend-dev' })
			];
		const sections = buildNavigationSections(categories, items);
		expect(sections[0].children.map((x) => x.slug)).toEqual(['frontend-dev']);
		expect(sections[0].items.map((x) => x.title)).toEqual(['GitHub', 'Vite']);
	});
});
