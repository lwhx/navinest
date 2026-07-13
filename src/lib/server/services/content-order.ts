import type { ContentType } from '$lib/types/content';
import type { Database, DatabaseStatement } from '$lib/server/db';
import { AdminWriteError } from '$lib/server/services/admin-write';
export type ItemOrderInput = { type: ContentType; categoryId: number; itemIds: number[] };
export async function reorderItems(database: Database, input: ItemOrderInput): Promise<void> {
	if (!input.itemIds.length || new Set(input.itemIds).size !== input.itemIds.length)
		throw new AdminWriteError('排序内容ID无效或重复。');
	const { results } = await database
		.prepare('SELECT id FROM items WHERE type = ? AND category_id = ? ORDER BY id')
		.bind(input.type, input.categoryId)
		.all<{ id: number }>();
	const expected = results.map((x) => x.id).sort((a, b) => a - b),
		actual = [...input.itemIds].sort((a, b) => a - b);
	if (expected.length !== actual.length || expected.some((id, i) => id !== actual[i]))
		throw new AdminWriteError('排序范围必须包含该类型和分类下的全部内容。');
	const statements: DatabaseStatement[] = input.itemIds.map((id, index) =>
		database
			.prepare(
				'UPDATE items SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND type = ? AND category_id = ?'
			)
			.bind((index + 1) * 10, id, input.type, input.categoryId)
	);
	const batch = (database as Database & { batch?: (s: DatabaseStatement[]) => Promise<unknown> })
		.batch;
	if (batch) await batch.call(database, statements);
	else for (const statement of statements) await statement.all();
}
