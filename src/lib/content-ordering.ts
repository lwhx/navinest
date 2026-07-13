export function moveOrderedItem(ids: number[], sourceId: number, targetId: number): number[] {
	const source = ids.indexOf(sourceId),
		target = ids.indexOf(targetId);
	if (source < 0 || target < 0 || source === target) return [...ids];
	const next = [...ids],
		[moved] = next.splice(source, 1);
	next.splice(target, 0, moved);
	return next;
}
