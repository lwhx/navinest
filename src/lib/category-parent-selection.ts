import type { Category, ContentType } from '$lib/types/content';
import { categoryBranch } from '$lib/category-tree';

export type ParentCategory = Pick<Category, 'id' | 'parentId' | 'type' | 'name'>;

export function categoryParentCandidates(
	categories: ParentCategory[],
	type: ContentType,
	editingId?: number
) {
	const editing = categories.find((category) => category.id === editingId);
	const blocked = new Set(
		editing ? categoryBranch(categories, editing).map((category) => category.id) : []
	);
	return categories.filter((category) => category.type === type && !blocked.has(category.id));
}

export function categoryParentPath(
	categories: ParentCategory[],
	value: string
): ParentCategory[] | null {
	if (value === '') return [];
	const id = Number(value);
	if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id <= 0) return null;
	const byId = new Map(categories.map((category) => [category.id, category]));
	const path: ParentCategory[] = [],
		seen = new Set<number>();
	let current: number | null = id;
	while (current !== null) {
		if (seen.has(current)) return null;
		const category = byId.get(current);
		if (!category) return null;
		seen.add(current);
		path.unshift(category);
		current = category.parentId;
	}
	return path;
}
