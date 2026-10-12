import { describe, expect, it } from 'vitest';
import { categoryBranch } from '$lib/category-tree';
import {
	categoryParentCandidates,
	categoryParentPath,
	type ParentCategory
} from '$lib/category-parent-selection';

const categories: ParentCategory[] = [
	{ id: 1, parentId: null, type: 'site', name: '开发工具' },
	{ id: 2, parentId: 1, type: 'site', name: '前端开发' },
	{ id: 3, parentId: 2, type: 'site', name: '框架资源' },
	{ id: 4, parentId: null, type: 'site', name: '设计资源' },
	{ id: 5, parentId: 4, type: 'site', name: '设计协作' },
	{ id: 6, parentId: null, type: 'post', name: '文章' },
	{ id: 7, parentId: null, type: 'app', name: '旧软件' }
];
describe('cascading category parent selection', () => {
	it('excludes other types and the entire editing subtree without mutating records', () => {
		const before = structuredClone(categories);
		expect(categoryParentCandidates(categories, 'site', 1).map((category) => category.id)).toEqual([
			4, 5
		]);
		expect(categoryParentCandidates(categories, 'site', 2).map((category) => category.id)).toEqual([
			1, 4, 5
		]);
		expect(categories).toEqual(before);
	});
	it('restores the complete path for existing deeper parents and handles roots separately', () => {
		expect(categoryParentPath(categories, '3')?.map((category) => category.name)).toEqual([
			'开发工具',
			'前端开发',
			'框架资源'
		]);
		expect(categoryParentPath(categories, '1')?.map((category) => category.id)).toEqual([1]);
		expect(categoryParentPath(categories, '')).toEqual([]);
	});
	it.each(['0', '-1', '1.5', '1e2', '999', 'bad'])(
		'rejects invalid or unavailable parent %s',
		(value) => {
			expect(categoryParentPath(categories, value)).toBeNull();
		}
	);
	it('does not treat a blocked descendant as a valid restored parent', () => {
		const candidates = categoryParentCandidates(categories, 'site', 2);
		expect(categoryParentPath(candidates, '3')).toBeNull();
	});
	it('detects missing ancestors and cycles and terminates traversal safely', () => {
		expect(categoryParentPath([{ ...categories[1], parentId: 999 }], '2')).toBeNull();
		const cyclic = [{ ...categories[0], parentId: 2 }, categories[1]];
		expect(categoryParentPath(cyclic, '2')).toBeNull();
		expect(categoryBranch(cyclic, cyclic[0]).map((category) => category.id)).toEqual([1, 2]);
	});
	it('retains legacy parent paths for existing-record maintenance', () => {
		expect(
			categoryParentPath(categoryParentCandidates(categories, 'app'), '7')?.map(
				(category) => category.id
			)
		).toEqual([7]);
	});
});
