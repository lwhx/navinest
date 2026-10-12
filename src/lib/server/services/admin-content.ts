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
		status: filters.mode === 'sort' || filters.status === 'all' ? null : filters.status,
		visibility: filters.mode === 'sort' || filters.visibility === 'all' ? null : filters.visibility,
		...(filters.type !== 'all' ? { type: filters.type } : {}),
		...(filters.category !== 'all'
			? { categoryId: filters.category === 'none' ? null : Number(filters.category) }
			: {}),
		search: filters.mode === 'sort' ? '' : filters.q,
		includeSlugInSearch: true
	};
}

export async function loadAdminContent(database: Database, params: URLSearchParams) {
	const filters = adminContentFilters(params);
	const [categories, tags, summary] = await Promise.all([
		listCategories(database, { visibleOnly: false }),
		listTags(database),
		loadAdminContentSummary(database)
	]);
	if (filters.mode === 'sort') {
		filters.page = 1;
		filters.q = '';
		filters.status = filters.visibility = 'all';
		if (filters.type === 'all') filters.type = 'site';
		if (
			!categories.some(
				(category) => String(category.id) === filters.category && category.type === filters.type
			)
		)
			filters.category = String(
				categories.find((category) => category.type === filters.type)?.id ?? 'all'
			);
	}
	const query = queryFor(filters);
	const total = await countItems(database, query);
	const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
	filters.page = Math.min(filters.page, pageCount);
	const orderComplete =
		filters.mode === 'sort' && filters.category !== 'all' && total <= ADMIN_SORT_LIMIT;
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
	return {
		items,
		categories,
		tags,
		files: [],
		summary,
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
	filters.mode = 'browse';
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
