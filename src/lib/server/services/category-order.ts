import type { Database } from '$lib/server/db';
import { AdminWriteError } from './admin-write';

export type CategoryOrderInput = {
	type: string;
	parentId: number | null;
	categoryIds: number[];
};

/** Reorders the full sibling scope (same type + parent) atomically with spaced sort values. */
export async function reorderCategories(
	database: Database,
	input: CategoryOrderInput
): Promise<void> {
	if (
		typeof input.type !== 'string' ||
		(input.parentId !== null && (!Number.isSafeInteger(input.parentId) || input.parentId <= 0)) ||
		!input.categoryIds.length ||
		new Set(input.categoryIds).size !== input.categoryIds.length ||
		input.categoryIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
	)
		throw new AdminWriteError('排序分类ID无效或重复。');
	// Same contract as content-order: the payload must list every sibling; one statement
	// validates the scope and rewrites it, so a stale list can never partially apply.
	const { results } = await database
		.prepare(
			`WITH desired AS (
		SELECT value AS id, (CAST(key AS INTEGER) + 1) * 10 AS position FROM json_each(?)
	), scope AS (SELECT id FROM categories WHERE type = ? AND parent_id IS ?)
	UPDATE categories SET sort_order = (SELECT position FROM desired WHERE desired.id = categories.id),
		updated_at = CURRENT_TIMESTAMP
	WHERE id IN (SELECT id FROM desired) AND (SELECT COUNT(*) FROM scope) = ?
		AND NOT EXISTS (SELECT id FROM desired EXCEPT SELECT id FROM scope)
	RETURNING id`
		)
		.bind(JSON.stringify(input.categoryIds), input.type, input.parentId, input.categoryIds.length)
		.all<{ id: number }>();
	if (results.length !== input.categoryIds.length)
		throw new AdminWriteError('排序范围必须包含该层级的全部分类，请刷新后重试。');
}
