import {
	adminContentFilters,
	BULK_CONTENT_ACTIONS,
	type AdminContentFilters,
	type BulkContentAction
} from '$lib/admin-content';
import type { Database } from '$lib/server/db';
import type { Item } from '$lib/types/content';
import { countItems, listItems, type ItemQuery } from './items';
import { listCategories } from './categories';
import { listTags } from './tags';
import { AdminWriteError } from './admin-write';

export const ADMIN_PAGE_SIZE = 50;
export const ADMIN_SORT_LIMIT = 500;

export async function loadAdminContentSummary(database: Database) {
	const { results } = await database
		.prepare(
			`SELECT type, COUNT(*) AS total,
		SUM(status = 'published') AS published, SUM(status = 'draft') AS draft,
		SUM(visibility = 'private') AS private FROM items GROUP BY type`
		)
		.all<{
			type: string;
			total: number;
			published: number;
			draft: number;
			private: number;
		}>();
	return {
		total: results.reduce((sum, row) => sum + row.total, 0),
		published: results.reduce((sum, row) => sum + row.published, 0),
		draft: results.reduce((sum, row) => sum + row.draft, 0),
		private: results.reduce((sum, row) => sum + row.private, 0),
		types: Object.fromEntries(results.map((row) => [row.type, row.total]))
	};
}

function queryFor(filters: AdminContentFilters): ItemQuery {
	return {
		status: filters.status === 'all' ? null : filters.status,
		visibility: filters.visibility === 'all' ? null : filters.visibility,
		...(filters.type !== 'all' ? { type: filters.type } : {}),
		...(filters.category !== 'all'
			? { categoryId: filters.category === 'none' ? null : Number(filters.category) }
			: {}),
		search: filters.q,
		includeSlugInSearch: true
	};
}

/** Per-category item counts for the active type; null category is keyed as "none". */
export async function countItemsByCategory(database: Database, type: string) {
	const { results } = await database
		.prepare('SELECT category_id, COUNT(*) AS total FROM items WHERE type = ? GROUP BY category_id')
		.bind(type)
		.all<{ category_id: number | null; total: number }>();
	return Object.fromEntries(
		results.map((row) => [row.category_id === null ? 'none' : String(row.category_id), row.total])
	);
}

export async function loadAdminContent(database: Database, params: URLSearchParams) {
	const filters = adminContentFilters(params);
	const [categories, tags, summary] = await Promise.all([
		listCategories(database, { visibleOnly: false }),
		listTags(database),
		loadAdminContentSummary(database)
	]);
	// A selected category implies its type: the type tab then reflects it, and the
	// category sidebar is always scoped to one type.
	const categoryEntry =
		filters.category !== 'all'
			? (categories.find((category) => String(category.id) === filters.category) ?? null)
			: null;
	if (categoryEntry) filters.type = categoryEntry.type as AdminContentFilters['type'];
	const query = queryFor(filters);
	const total = await countItems(database, query);
	const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
	filters.page = Math.min(filters.page, pageCount);
	// Browsing one category without search or status filters IS the sortable view:
	// the complete list is loaded so drags can go to the strict full-scope order API.
	const orderComplete =
		filters.type !== 'all' &&
		filters.category !== 'all' &&
		!filters.q &&
		filters.status === 'all' &&
		filters.visibility === 'all' &&
		total <= ADMIN_SORT_LIMIT;
	let items: Item[];
	if (orderComplete) {
		// Read the complete category, rather than sending a page fragment to the strict order API.
		items = [];
		for (let offset = 0; offset < total; offset += 100)
			items.push(...(await listItems(database, { ...query, limit: 100, offset })));
	} else
		items = await listItems(database, {
			...query,
			limit: ADMIN_PAGE_SIZE,
			offset: (filters.page - 1) * ADMIN_PAGE_SIZE
		});
	const categoryCounts =
		filters.type === 'all' ? {} : await countItemsByCategory(database, filters.type);
	return {
		items,
		categories,
		tags,
		files: [],
		summary,
		categoryCounts,
		filters,
		total,
		pageCount,
		pageSize: ADMIN_PAGE_SIZE,
		orderComplete,
		sortLimit: ADMIN_SORT_LIMIT,
		source: 'database' as const
	};
}

export function paginateAdminFallback(data: { items: Item[] }, params: URLSearchParams) {
	const filters = adminContentFilters(params);
	const summary = {
		total: data.items.length,
		published: data.items.filter((item) => item.status === 'published').length,
		draft: data.items.filter((item) => item.status === 'draft').length,
		private: data.items.filter((item) => item.visibility === 'private').length,
		types: Object.fromEntries(
			['site', 'post', 'app', 'book', 'bulletin'].map((type) => [
				type,
				data.items.filter((item) => item.type === type).length
			])
		)
	};
	const matches = data.items.filter(
		(item) =>
			(filters.type === 'all' || item.type === filters.type) &&
			(filters.category === 'all' ||
				(filters.category === 'none'
					? item.categoryId === null
					: String(item.categoryId) === filters.category)) &&
			(filters.status === 'all' || item.status === filters.status) &&
			(filters.visibility === 'all' || item.visibility === filters.visibility) &&
			`${item.title} ${item.slug} ${item.summary ?? ''} ${item.category?.name ?? ''} ${item.tags.map((tag) => tag.name).join(' ')}`
				.toLowerCase()
				.includes(filters.q.toLowerCase())
	);
	const total = matches.length,
		pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
	filters.page = Math.min(filters.page, pageCount);
	return {
		items: matches.slice((filters.page - 1) * ADMIN_PAGE_SIZE, filters.page * ADMIN_PAGE_SIZE),
		filters,
		summary,
		total,
		pageCount,
		pageSize: ADMIN_PAGE_SIZE,
		orderComplete: false,
		sortLimit: ADMIN_SORT_LIMIT
	};
}

/** Moves up to 50 items of one type into a category, appending them after its current order. */
async function bulkMoveItems(database: Database, ids: number[], categoryId: unknown) {
	const targetCategoryId =
		typeof categoryId === 'number' && Number.isSafeInteger(categoryId) && categoryId > 0
			? categoryId
			: null;
	if (!targetCategoryId) throw new AdminWriteError('请选择要移动到的目标分类。');
	const category = (
		await database
			.prepare('SELECT id, type FROM categories WHERE id = ?')
			.bind(targetCategoryId)
			.all<{ id: number; type: string }>()
	).results[0];
	if (!category) throw new AdminWriteError('目标分类不存在，请刷新后重试。', undefined, 404);
	const typedRows = (
		await database
			.prepare(
				'SELECT type, COUNT(*) AS n FROM items WHERE id IN (SELECT value FROM json_each(?)) GROUP BY type'
			)
			.bind(JSON.stringify(ids))
			.all<{ type: string; n: number }>()
	).results;
	const movedTotal = typedRows.reduce((sum, row) => sum + row.n, 0);
	if (movedTotal !== ids.length)
		throw new AdminWriteError('所选内容已发生变化，请刷新后重新选择。', undefined, 409);
	if (typedRows.length !== 1) throw new AdminWriteError('所选内容的类型不一致，请按类型分开移动。');
	if (typedRows[0].type !== category.type)
		throw new AdminWriteError('目标分类与所选内容的类型不一致，请重新选择分类。');
	const base =
		(
			await database
				.prepare(
					'SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM items WHERE type = ? AND category_id = ?'
				)
				.bind(category.type, targetCategoryId)
				.all<{ maxSort: number }>()
		).results[0]?.maxSort ?? 0;
	// One statement: the appended block gets spaced sort values after the current tail.
	const { results } = await database
		.prepare(
			`WITH selected AS (SELECT value AS id, (CAST(key AS INTEGER) + 1) * 10 AS position FROM json_each(?))
		UPDATE items SET category_id = ?,
			sort_order = ? + (SELECT position FROM selected WHERE selected.id = items.id),
			updated_at = CURRENT_TIMESTAMP
		WHERE id IN (SELECT id FROM selected)
		AND (SELECT COUNT(*) FROM items WHERE id IN (SELECT id FROM selected)) = ? RETURNING id`
		)
		.bind(JSON.stringify(ids), targetCategoryId, base, ids.length)
		.all<{ id: number }>();
	if (results.length !== ids.length)
		throw new AdminWriteError('所选内容已发生变化，请刷新后重新选择。', undefined, 409);
	return { count: results.length };
}

export async function bulkUpdateAdminContent(database: Database, input: Record<string, unknown>) {
	const ids = input.ids;
	if (
		!Array.isArray(ids) ||
		!ids.length ||
		ids.length > ADMIN_PAGE_SIZE ||
		ids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) ||
		new Set(ids).size !== ids.length
	)
		throw new AdminWriteError('请选择 1–50 条有效且不重复的内容。');
	if (input.action === 'move') return bulkMoveItems(database, ids, input.categoryId);
	if (!BULK_CONTENT_ACTIONS.some((action) => action.value === input.action))
		throw new AdminWriteError('批量操作无效。');
	const action = input.action as BulkContentAction;
	const assignments =
		action === 'publish'
			? "status = 'published', published_at = COALESCE(published_at, CURRENT_TIMESTAMP)"
			: action === 'draft'
				? "status = 'draft', published_at = NULL"
				: `is_featured = ${action === 'feature' ? 1 : 0}`;
	// One statement: stale/missing IDs cannot cause a partial update between validation and write.
	const { results } = await database
		.prepare(
			`WITH selected AS (SELECT value AS id FROM json_each(?))
		UPDATE items SET ${assignments}, updated_at = CURRENT_TIMESTAMP
		WHERE id IN (SELECT id FROM selected)
		AND (SELECT COUNT(*) FROM items WHERE id IN (SELECT id FROM selected)) = ? RETURNING id`
		)
		.bind(JSON.stringify(ids), ids.length)
		.all<{ id: number }>();
	if (results.length !== ids.length)
		throw new AdminWriteError('所选内容已发生变化，请刷新后重新选择。', undefined, 409);
	return { count: results.length };
}
