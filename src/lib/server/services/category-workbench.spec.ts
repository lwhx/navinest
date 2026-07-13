import { describe, expect, it } from 'vitest';
import { buildCategoryWorkbench } from '$lib/server/services/category-workbench';
const categories = [
	{
		id: 1,
		parentId: null,
		type: 'site',
		name: '开发工具',
		slug: 'dev-tools',
		icon: 'code',
		description: null,
		sortOrder: 10,
		isVisible: true,
		createdAt: '',
		updatedAt: ''
	},
	{
		id: 2,
		parentId: 1,
		type: 'site',
		name: '前端开发',
		slug: 'frontend',
		icon: null,
		description: null,
		sortOrder: 20,
		isVisible: true,
		createdAt: '',
		updatedAt: ''
	},
	{
		id: 3,
		parentId: 1,
		type: 'site',
		name: '容器部署',
		slug: 'containers',
		icon: null,
		description: null,
		sortOrder: 30,
		isVisible: false,
		createdAt: '',
		updatedAt: ''
	},
	{
		id: 4,
		parentId: null,
		type: 'post',
		name: '文章',
		slug: 'posts',
		icon: null,
		description: null,
		sortOrder: 40,
		isVisible: true,
		createdAt: '',
		updatedAt: ''
	}
] as const;
describe('category workbench', () => {
	it('builds a parent-child tree with direct and aggregate usage', () => {
		const result = buildCategoryWorkbench(categories as never, [
			{ categoryId: 1, count: 1 },
			{ categoryId: 2, count: 3 }
		]);
		expect(result.roots).toHaveLength(2);
		expect(result.roots[0]).toMatchObject({
			id: 1,
			path: '开发工具',
			directItemCount: 1,
			totalItemCount: 4,
			childCount: 2,
			canDelete: false
		});
		expect(result.roots[0].children[0]).toMatchObject({
			id: 2,
			path: '开发工具 / 前端开发',
			directItemCount: 3,
			totalItemCount: 3,
			canDelete: false
		});
		expect(result.roots[0].children[1]).toMatchObject({ id: 3, isVisible: false, canDelete: true });
	});
	it('summarizes totals for filtering and impact guidance', () => {
		const result = buildCategoryWorkbench(categories as never, []);
		expect(result.summary).toEqual({ total: 4, roots: 2, children: 2, hidden: 1, used: 0 });
	});
});
