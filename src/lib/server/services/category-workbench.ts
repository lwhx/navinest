import type { Category } from '$lib/types/content';
export type CategoryUsage = { categoryId: number; count: number };
export type CategoryWorkbenchNode = Category & {
	path: string;
	directItemCount: number;
	totalItemCount: number;
	childCount: number;
	canDelete: boolean;
	deleteImpact: string;
	children: CategoryWorkbenchNode[];
};
export function buildCategoryWorkbench(categories: Category[], usage: CategoryUsage[]) {
	const counts = new Map(usage.map((x) => [x.categoryId, x.count])),
		byParent = new Map<number | null, Category[]>();
	for (const category of categories) {
		const key = category.parentId ?? null;
		byParent.set(key, [...(byParent.get(key) ?? []), category]);
	}
	const build = (category: Category, parentPath = ''): CategoryWorkbenchNode => {
		const children = (byParent.get(category.id) ?? []).map((child) =>
			build(child, parentPath ? `${parentPath} / ${category.name}` : category.name)
		);
		const directItemCount = counts.get(category.id) ?? 0,
			totalItemCount =
				directItemCount + children.reduce((sum, child) => sum + child.totalItemCount, 0),
			childCount = children.length,
			canDelete = directItemCount === 0 && childCount === 0;
		return {
			...category,
			path: parentPath ? `${parentPath} / ${category.name}` : category.name,
			directItemCount,
			totalItemCount,
			childCount,
			canDelete,
			deleteImpact: canDelete
				? '未被内容或子分类引用，可以安全删除。'
				: `包含 ${childCount} 个子分类、${directItemCount} 条直属内容，删除前需先处理引用。`,
			children
		};
	};
	const roots = (byParent.get(null) ?? []).map((category) => build(category));
	return {
		roots,
		summary: {
			total: categories.length,
			roots: roots.length,
			children: categories.filter((x) => x.parentId != null).length,
			hidden: categories.filter((x) => !x.isVisible).length,
			used: categories.filter((x) => (counts.get(x.id) ?? 0) > 0).length
		}
	};
}
