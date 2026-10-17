import type { Database, DatabaseStatement } from '$lib/server/db';
import { listSearchEngines } from './search-engines';
import { AdminWriteError } from './admin-write';
import { validSearchTemplate } from '$lib/search-source';

export async function searchSourceWorkspace(database: Database, params: URLSearchParams) {
	const all = await listSearchEngines(database, false);
	return searchSourceView(all, params);
}
export function searchSourceView(
	all: Awaited<ReturnType<typeof listSearchEngines>>,
	params: URLSearchParams
) {
	const q = (params.get('q') ?? '').trim().slice(0, 200),
		group = params.get('group') ?? '',
		status = ['enabled', 'disabled', 'invalid'].includes(params.get('status') ?? '')
			? params.get('status')!
			: '',
		rows = all.map((row, index) => ({
			...row,
			position: index + 1,
			templateValid: validSearchTemplate(row.urlTemplate)
		})),
		matching = rows.filter(
			(row) =>
				(!q ||
					[row.name, row.key, row.groupKey, row.urlTemplate, row.placeholder ?? ''].some((v) =>
						v.toLowerCase().includes(q.toLowerCase())
					)) &&
				(!group || row.groupKey === group) &&
				(!status ||
					(status === 'enabled'
						? row.isEnabled
						: status === 'disabled'
							? !row.isEnabled
							: !row.templateValid))
		),
		pages = Math.max(1, Math.ceil(matching.length / 20)),
		requested = Number(params.get('page')),
		page = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1),
		editId = Number(params.get('edit'));
	return {
		searchEngines: matching.slice((page - 1) * 20, page * 20),
		total: matching.length,
		page,
		pages,
		filters: { q, group, status },
		groups: [...new Set(all.map((row) => row.groupKey))].sort(),
		counts: {
			total: all.length,
			enabled: all.filter((row) => row.isEnabled).length,
			invalid: rows.filter((row) => !row.templateValid).length
		},
		defaultEngine: rows.find((row) => row.isEnabled && row.templateValid) ?? null,
		mode: params.has('create')
			? ('create' as const)
			: Number.isSafeInteger(editId) && editId > 0
				? ('edit' as const)
				: null,
		editing: rows.find((row) => row.id === editId) ?? null
	};
}
type OrderRow = {
	id: number;
	sortOrder: number;
	name: string;
	enabled: number;
	urlTemplate: string;
};
const orderRows =
	'SELECT id,sort_order sortOrder,name,is_enabled enabled,url_template urlTemplate FROM search_engines ORDER BY sort_order,name,id';
export async function reorderSearchSource(
	database: Database,
	id: number,
	direction: 'up' | 'down' | 'first'
) {
	const rows = (await database.prepare(orderRows).all<OrderRow>()).results,
		index = rows.findIndex((row) => row.id === id);
	if (index < 0) throw new AdminWriteError('搜索源不存在。', undefined, 404);
	if (
		direction === 'first' &&
		(!rows[index].enabled || !validSearchTemplate(rows[index].urlTemplate))
	)
		throw new AdminWriteError('请先修正模板并启用该搜索源，再设为首次默认。', undefined, 409);
	const to = direction === 'first' ? 0 : direction === 'up' ? index - 1 : index + 1;
	if (to < 0 || to >= rows.length || to === index) return;
	const ordered = [...rows];
	ordered.splice(to, 0, ordered.splice(index, 1)[0]);
	const batch = (
		database as Database & { batch?: (statements: DatabaseStatement[]) => Promise<unknown> }
	).batch;
	if (!batch) throw new AdminWriteError('当前数据库不支持原子排序。');
	const snapshot = JSON.stringify(
			rows.map((row) => ({
				id: row.id,
				sortOrder: row.sortOrder,
				name: row.name,
				enabled: row.enabled,
				urlTemplate: row.urlTemplate
			}))
		),
		plan = JSON.stringify(ordered.map((row, index) => ({ id: row.id, order: (index + 1) * 10 })));
	if (new TextEncoder().encode(snapshot + plan).byteLength > 1_000_000)
		throw new AdminWriteError('搜索源数量超过在线排序范围，请逐项修改排序值。');
	try {
		await batch.call(database, [
			database
				.prepare(
					`SELECT CASE WHEN (SELECT json_group_array(json_object('id',id,'sortOrder',sortOrder,'name',name,'enabled',enabled,'urlTemplate',urlTemplate)) FROM (${orderRows}))=? THEN 1 ELSE json('SEARCH_SOURCES_CHANGED') END`
				)
				.bind(snapshot),
			database
				.prepare(
					"UPDATE search_engines SET sort_order=(SELECT value->>'$.order' FROM json_each(?) WHERE value->>'$.id'=search_engines.id) WHERE id IN (SELECT value->>'$.id' FROM json_each(?))"
				)
				.bind(plan, plan)
		]);
	} catch (error) {
		if (error instanceof Error && /SEARCH_SOURCES_CHANGED|malformed JSON/i.test(error.message))
			throw new AdminWriteError('排序或启用状态已变化，请刷新列表后重试。', undefined, 409);
		throw error;
	}
}
export async function setSearchSourceEnabled(database: Database, id: number, expected: boolean) {
	const changed = (
		await database
			.prepare('UPDATE search_engines SET is_enabled=? WHERE id=? AND is_enabled=? RETURNING id')
			.bind(expected ? 0 : 1, id, expected ? 1 : 0)
			.all<{ id: number }>()
	).results;
	if (!changed.length)
		throw new AdminWriteError('搜索源状态已变化或记录已移除，请刷新核对。', undefined, 409);
}
