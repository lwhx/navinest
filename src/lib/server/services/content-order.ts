import type { ContentType } from '$lib/types/content';
import type { Database } from '$lib/server/db';
import { AdminWriteError } from '$lib/server/services/admin-write';
export type ItemOrderInput = { type: ContentType; categoryId: number; itemIds: number[] };
export async function reorderItems(database: Database, input: ItemOrderInput): Promise<void> {
	if (
		!input.itemIds.length ||
		new Set(input.itemIds).size !== input.itemIds.length ||
		input.itemIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
	)
		throw new AdminWriteError('排序内容ID无效或重复。');
	// D1 supports JSON array parameters. Validate the full scope and update it atomically in one
	// statement, avoiding both parameter limits and one query per item.
	const { results } = await database
		.prepare(
			`WITH desired AS (
		SELECT value AS id, (CAST(key AS INTEGER) + 1) * 10 AS position FROM json_each(?)
	), scope AS (SELECT id FROM items WHERE type = ? AND category_id = ?)
	UPDATE items SET sort_order = (SELECT position FROM desired WHERE desired.id = items.id),
		updated_at = CURRENT_TIMESTAMP
	WHERE id IN (SELECT id FROM desired) AND (SELECT COUNT(*) FROM scope) = ?
		AND NOT EXISTS (SELECT id FROM desired EXCEPT SELECT id FROM scope)
	RETURNING id`
		)
		.bind(JSON.stringify(input.itemIds), input.type, input.categoryId, input.itemIds.length)
		.all<{ id: number }>();
	if (results.length !== input.itemIds.length)
		throw new AdminWriteError('排序范围必须包含该类型和分类下的全部内容，请刷新后重试。');
}
