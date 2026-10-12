export function categoryBranch<T extends { id?: number; parentId?: number | null }>(
	categories: T[],
	root: T
): T[] {
	const byParent = new Map<number, T[]>();
	for (const category of categories) {
		if (category.parentId != null)
			byParent.set(category.parentId, [...(byParent.get(category.parentId) ?? []), category]);
	}
	const queue = [root],
		seen = new Set<T>(),
		branch: T[] = [];
	for (let i = 0; i < queue.length; i++) {
		const category = queue[i];
		if (seen.has(category)) continue;
		seen.add(category);
		branch.push(category);
		if (category.id != null) queue.push(...(byParent.get(category.id) ?? []));
	}
	return branch;
}
