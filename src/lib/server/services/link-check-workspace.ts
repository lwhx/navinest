import type { Database } from '$lib/server/db';
import { AdminWriteError } from './admin-write';
import { probeLink, type ProbeOptions } from './link-probe';
import {
	LINK_CHECK_BATCH_SIZE,
	linkCheckFilters,
	type LinkCheckResult,
	type LinkCheckStatus
} from '$lib/link-checks';

// Runtime records live outside public item metadata and portable configuration backups.
export const LINK_CHECK_PREFIX = 'admin:link-check:';
const leaseKey = LINK_CHECK_PREFIX + 'lease';
const itemPrefix = LINK_CHECK_PREFIX + 'item:';
const PAGE_SIZE = 20;
const resultSql = `CASE WHEN json_valid(s.value_json) THEN s.value_json ELSE NULL END`;
const sourceSql = `FROM items i LEFT JOIN item_meta m ON m.item_id=i.id AND m.meta_key='site_url'
 LEFT JOIN settings s ON s.key='${itemPrefix}'||i.id`;
const statusSql = `CASE
 WHEN json_extract(${resultSql},'$.status') NOT IN ('reachable','redirected','gone','uncertain','blocked') OR json_extract(${resultSql},'$.url') IS NULL THEN 'unchecked'
 WHEN json_extract(${resultSql},'$.url')<>COALESCE(m.meta_value,'') THEN 'stale'
 ELSE COALESCE(json_extract(${resultSql},'$.status'),'unchecked') END`;
export async function loadLinkChecks(db: Database, params: URLSearchParams) {
	const filters = linkCheckFilters(params),
		values: string[] = [];
	let where = `WHERE i.type='site'`;
	if (filters.q) {
		where += ` AND (instr(lower(i.title),lower(?))>0 OR instr(lower(COALESCE(m.meta_value,'')),lower(?))>0)`;
		values.push(filters.q, filters.q);
	}
	if (filters.result !== 'all') {
		where += ` AND (${statusSql})=?`;
		values.push(filters.result);
	}
	const total = Number(
		(
			await db
				.prepare(`SELECT COUNT(*) total ${sourceSql} ${where}`)
				.bind(...values)
				.all<{ total: number }>()
		).results[0]?.total ?? 0
	);
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE)),
		page = Math.min(filters.page, pageCount);
	const rows = (
		await db
			.prepare(
				`SELECT i.id,i.title,i.status publication,i.visibility,COALESCE(m.meta_value,'') url,c.name category,
 (${statusSql}) status,${resultSql} result ${sourceSql} LEFT JOIN categories c ON c.id=i.category_id
 ${where} ORDER BY i.id DESC LIMIT ? OFFSET ?`
			)
			.bind(...values, PAGE_SIZE, (page - 1) * PAGE_SIZE)
			.all<{
				id: number;
				title: string;
				publication: string;
				visibility: string;
				url: string;
				category: string | null;
				status: LinkCheckStatus;
				result: string | null;
			}>()
	).results;
	return {
		items: rows.map((row) => ({
			...row,
			result: row.result ? (JSON.parse(row.result) as LinkCheckResult) : null
		})),
		filters: { ...filters, page },
		total,
		page,
		pageCount,
		pageSize: PAGE_SIZE
	};
}

export async function runLinkChecks(db: Database, input: unknown, options: ProbeOptions = {}) {
	if (
		!Array.isArray(input) ||
		!input.length ||
		input.length > LINK_CHECK_BATCH_SIZE ||
		new Set(input).size !== input.length ||
		input.some((id) => !Number.isSafeInteger(id) || id <= 0)
	)
		throw new AdminWriteError(`每次请选择 1–${LINK_CHECK_BATCH_SIZE} 个不同的网址。`);
	const ids = input as number[],
		token = crypto.randomUUID(),
		now = Date.now();
	const acquired = (
		await db
			.prepare(
				`INSERT INTO settings(key,value_json) VALUES(?,?)
 ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json
 WHERE CASE WHEN json_valid(settings.value_json) THEN COALESCE(json_extract(settings.value_json,'$.expires'),0) ELSE 0 END<=?
 RETURNING key`
			)
			.bind(leaseKey, JSON.stringify({ token, expires: now + 60_000 }), now)
			.all()
	).results;
	if (!acquired.length)
		throw new AdminWriteError('已有检查正在进行，请稍后刷新查看结果。', undefined, 409);
	try {
		const sources = (
			await db
				.prepare(
					`SELECT i.id,COALESCE(m.meta_value,'') url FROM items i LEFT JOIN item_meta m ON m.item_id=i.id AND m.meta_key='site_url'
 WHERE i.type='site' AND i.id IN(SELECT value FROM json_each(?)) ORDER BY i.id`
				)
				.bind(JSON.stringify(ids))
				.all<{ id: number; url: string }>()
		).results;
		if (sources.length !== ids.length)
			throw new AdminWriteError('所选内容已变化，请刷新后重新选择。', undefined, 409);
		const results: Array<{ id: number; result: LinkCheckResult }> = [];
		let next = 0;
		await Promise.all(
			Array.from({ length: Math.min(2, sources.length) }, async () => {
				while (next < sources.length) {
					const source = sources[next++];
					results.push({ id: source.id, result: await probeLink(source.url, options) });
				}
			})
		);
		// One statement writes only unchanged URLs while this run still owns the lease.
		const saved = (
			await db
				.prepare(
					`INSERT INTO settings(key,value_json)
 SELECT '${itemPrefix}'||i.id,json_extract(d.value,'$.result') FROM json_each(?) d
 JOIN items i ON i.id=json_extract(d.value,'$.id') AND i.type='site'
 LEFT JOIN item_meta m ON m.item_id=i.id AND m.meta_key='site_url'
 WHERE COALESCE(m.meta_value,'')=json_extract(d.value,'$.result.url')
 AND EXISTS(SELECT 1 FROM settings WHERE key=? AND json_extract(value_json,'$.token')=? AND json_extract(value_json,'$.expires')>?)
 ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json RETURNING key`
				)
				.bind(JSON.stringify(results), leaseKey, token, Date.now())
				.all()
		).results.length;
		return { saved, skipped: ids.length - saved };
	} finally {
		await db
			.prepare(
				`DELETE FROM settings WHERE key=? AND CASE WHEN json_valid(value_json) THEN json_extract(value_json,'$.token') ELSE NULL END=?`
			)
			.bind(leaseKey, token)
			.all();
	}
}
