import type { Database, DatabaseStatement } from '$lib/server/db';
import {
	BOOKMARK_IMPORT_LIMIT,
	type BookmarkMapping,
	type BookmarkPreview,
	type BookmarkReceipt
} from '$lib/bookmark-import';
import { bookmarkUrlKey, parseBookmarkDocument } from './bookmark-import';
import { backupDigest, jsonChunks } from './site-backup-state';

export const BOOKMARK_RECEIPT_PREFIX = 'user:bookmark-import:';
export class BookmarkImportError extends Error {
	constructor(
		message: string,
		public status = 400,
		public uncertain = false
	) {
		super(message);
	}
}
const specs = [
	{ table: 'custom_categories', columns: 'id,parent_id,name,icon,sort_order' },
	{ table: 'custom_links', columns: 'id,category_id,title,url,icon_url,summary,sort_order,status' }
] as const;
async function state(db: Database, userId: number) {
	const result = await Promise.all(
		specs.map(async (spec) => ({
			...spec,
			rows: (
				await db
					.prepare(
						`SELECT json_array(${spec.columns}) value FROM ${spec.table} WHERE user_id=? ORDER BY id LIMIT 20001`
					)
					.bind(userId)
					.all<{ value: string }>()
			).results.map((r) => r.value)
		}))
	);
	if (
		result.some((s) => s.rows.length > 20000) ||
		result.reduce(
			(n, s) => n + s.rows.reduce((sum, r) => sum + new TextEncoder().encode(r).byteLength, 0),
			0
		) >
			8 * 1024 * 1024
	)
		throw new BookmarkImportError('现有导航数据超过在线核对范围，尚未执行导入。', 413);
	return result;
}
const object = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const idPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function receiptKey(userId: number, runId: unknown) {
	if (typeof runId !== 'string' || !idPattern.test(runId))
		throw new BookmarkImportError('导入批次无效。');
	return BOOKMARK_RECEIPT_PREFIX + userId + ':' + runId;
}
export async function bookmarkImportReceipt(
	db: Database,
	userId: number,
	runId: unknown
): Promise<BookmarkReceipt | null> {
	const row = (
		await db
			.prepare('SELECT value_json FROM settings WHERE key=?')
			.bind(receiptKey(userId, runId))
			.all<{ value_json: string }>()
	).results[0];
	if (!row) return null;
	try {
		const value = JSON.parse(row.value_json) as BookmarkReceipt;
		if (
			!['completed', 'cancelled'].includes(value.status) ||
			typeof value.digest !== 'string' ||
			!/^[a-f\d]{64}$/.test(value.digest) ||
			!Number.isSafeInteger(value.imported) ||
			value.imported < 0 ||
			value.imported > 500 ||
			!Number.isSafeInteger(value.categories) ||
			value.categories < 0 ||
			value.categories > 500 ||
			!Number.isFinite(Date.parse(value.completedAt))
		)
			throw new Error();
		return value;
	} catch {
		throw new BookmarkImportError('导入记录异常，请保留批次信息并联系维护者核对。', 503, true);
	}
}
function requireDigest(value: unknown): asserts value is string {
	if (typeof value !== 'string' || !/^[a-f\d]{64}$/.test(value))
		throw new BookmarkImportError('请先生成并核对导入预览。', 428);
}
function matches(receipt: BookmarkReceipt, digest: string) {
	if (receipt.digest !== digest)
		throw new BookmarkImportError('批次与当前预览不一致，请核对原批次。', 409, true);
	return receipt;
}
export async function cancelBookmarkImport(
	db: Database,
	userId: number,
	runId: unknown,
	digest: unknown
) {
	requireDigest(digest);
	const value: BookmarkReceipt = {
		digest,
		status: 'cancelled',
		imported: 0,
		categories: 0,
		completedAt: new Date().toISOString()
	};
	await db
		.prepare('INSERT INTO settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO NOTHING')
		.bind(receiptKey(userId, runId), JSON.stringify(value))
		.all();
	const stored = await bookmarkImportReceipt(db, userId, runId);
	if (!stored) throw new BookmarkImportError('尚未确认批次状态，请再次核对。', 503, true);
	return matches(stored, digest);
}

export async function prepareBookmarkImport(db: Database, userId: number, input: unknown) {
	if (!object(input)) throw new BookmarkImportError('导入内容格式无效。');
	const rows = parseBookmarkDocument(input.html),
		snapshot = await state(db, userId);
	try {
		if (snapshot.reduce((n, s) => n + Math.max(1, jsonChunks(s.rows, 400_000).length), 0) > 20)
			throw new Error();
	} catch {
		throw new BookmarkImportError('现有导航数据超过在线核对范围，尚未执行导入。', 413);
	}
	const categories = snapshot[0].rows.map((raw) => {
		const r = JSON.parse(raw);
		return { id: Number(r[0]), name: String(r[2]) };
	});
	const categoriesById = new Map(categories.map((c) => [c.id, c]));
	const categoriesByName = new Map<string, typeof categories>();
	for (const category of categories) {
		const group = categoriesByName.get(category.name) ?? [];
		group.push(category);
		categoriesByName.set(category.name, group);
	}
	const existing = new Set(snapshot[1].rows.map((raw) => bookmarkUrlKey(JSON.parse(raw)[3]))),
		seen = new Set<string>();
	let defaults = 0;
	for (const row of rows) {
		if (row.error) continue;
		const key = bookmarkUrlKey(row.url);
		row.status = existing.has(key)
			? 'existing'
			: seen.has(key)
				? 'duplicate'
				: defaults++ >= BOOKMARK_IMPORT_LIMIT
					? 'limited'
					: 'new';
		row.selected = row.status === 'new';
		seen.add(key);
	}
	if (input.selected !== undefined) {
		if (
			!Array.isArray(input.selected) ||
			input.selected.length > BOOKMARK_IMPORT_LIMIT ||
			new Set(input.selected).size !== input.selected.length ||
			input.selected.some(
				(id) =>
					!Number.isSafeInteger(id) ||
					!rows[Number(id)] ||
					!['new', 'limited'].includes(rows[Number(id)].status)
			)
		)
			throw new BookmarkImportError('每批请选择最多 500 条不同的可导入书签。');
		const selected = new Set(input.selected);
		for (const row of rows) row.selected = selected.has(row.id);
		for (const row of rows)
			if (['new', 'limited'].includes(row.status))
				row.status = row.selected || selected.size < BOOKMARK_IMPORT_LIMIT ? 'new' : 'limited';
	}
	const folders = [
		...new Set(rows.filter((r) => ['new', 'limited'].includes(r.status)).map((r) => r.folder))
	];
	const folderSet = new Set(rows.map((r) => r.folder));
	const chosenFolders = new Set(rows.filter((r) => r.selected).map((r) => r.folder));
	if (
		input.mappings !== undefined &&
		(!Array.isArray(input.mappings) || input.mappings.length > 5000)
	)
		throw new BookmarkImportError('分类对应格式无效。');
	const supplied = new Map<string, Record<string, unknown>>();
	for (const m of (input.mappings ?? []) as unknown[]) {
		if (
			!object(m) ||
			typeof m.folder !== 'string' ||
			!folderSet.has(m.folder) ||
			supplied.has(m.folder)
		)
			throw new BookmarkImportError('分类对应包含无效或重复的文件夹。');
		supplied.set(m.folder, m);
	}
	const mappings: BookmarkMapping[] = folders.map((folder) => {
		const name = folder.length <= 80 ? folder : folder.split(' / ').at(-1)!.slice(0, 80);
		const match = categoriesByName.get(name) ?? [];
		const raw = (chosenFolders.has(folder) ? supplied.get(folder) : undefined) ?? {
			target: folder
				? match.length === 1
					? 'existing'
					: match.length > 1
						? 'choose'
						: 'new'
				: 'none',
			categoryId: match.length === 1 ? match[0].id : null,
			name
		};
		if (!['none', 'existing', 'new', 'choose'].includes(String(raw.target)))
			throw new BookmarkImportError('请选择有效的分类对应方式。');
		const result: BookmarkMapping = {
			folder,
			target: raw.target as BookmarkMapping['target'],
			categoryId: null,
			name: ''
		};
		if (result.target === 'existing') {
			const category = categoriesById.get(raw.categoryId as number);
			if (!category)
				throw new BookmarkImportError('目标分类已失效或不属于当前账号，请重新预览。', 409);
			result.categoryId = category.id;
			result.name = category.name;
		}
		if (result.target === 'new') {
			if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 80)
				throw new BookmarkImportError('新分类名称需为 1–80 个字符。');
			result.name = raw.name.trim();
			if (categoriesByName.has(result.name))
				throw new BookmarkImportError(`分类“${result.name}”已存在，请选择具体已有分类。`);
		}
		return result;
	});
	const selected = rows.filter((r) => r.selected),
		selectedFolders = new Set(selected.map((r) => r.folder));
	const newCategories = [
		...new Set(
			mappings.filter((m) => selectedFolders.has(m.folder) && m.target === 'new').map((m) => m.name)
		)
	];
	const generatedAt =
		typeof input.previewAt === 'string' ? input.previewAt : new Date().toISOString();
	if (!Number.isFinite(Date.parse(generatedAt))) throw new BookmarkImportError('预览时间无效。');
	const digest = await backupDigest({
		userId,
		html: input.html,
		selected: selected.map((r) => r.id),
		mappings,
		snapshot,
		generatedAt
	});
	const preview: BookmarkPreview = {
		digest,
		generatedAt,
		rows,
		mappings,
		categories,
		selected: selected.length,
		newCategories,
		total: rows.length
	};
	return { preview, snapshot };
}

export async function commitBookmarkImport(db: Database, userId: number, input: unknown) {
	if (!object(input)) throw new BookmarkImportError('导入内容格式无效。');
	requireDigest(input.digest);
	if (input.confirmed !== true) throw new BookmarkImportError('请先核对预览并确认导入。', 428);
	const key = receiptKey(userId, input.runId),
		prior = await bookmarkImportReceipt(db, userId, input.runId);
	if (prior) return matches(prior, input.digest);
	const { preview, snapshot } = await prepareBookmarkImport(db, userId, input);
	if (preview.digest !== input.digest)
		throw new BookmarkImportError('文件、勾选、分类或现有导航已变化，请更新预览后再导入。', 409);
	const age = Date.now() - Date.parse(preview.generatedAt);
	if (age > 15 * 60_000 || age < -60_000)
		throw new BookmarkImportError('预览已过期，请更新预览。', 409);
	if (!preview.selected) throw new BookmarkImportError('请至少选择一条可导入书签。');
	const selectedFolders = new Set(preview.rows.filter((r) => r.selected).map((r) => r.folder));
	if (preview.mappings.some((m) => selectedFolders.has(m.folder) && m.target === 'choose'))
		throw new BookmarkImportError('存在同名分类，请先为所选文件夹选择具体目标分类。');
	const batch = (db as Database & { batch?: (s: DatabaseStatement[]) => Promise<unknown> }).batch;
	if (!batch) throw new BookmarkImportError('当前数据库不支持整批提交，尚未执行导入。', 503);
	const guards = snapshot.flatMap((spec) =>
		(jsonChunks(spec.rows, 400_000).length ? jsonChunks(spec.rows, 400_000) : ['[]']).map((chunk) =>
			db
				.prepare(
					`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM settings WHERE key=?) AND (SELECT COUNT(*) FROM ${spec.table} WHERE user_id=?)=?
		AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM ${spec.table}
		WHERE user_id=? AND id=json_extract(expected.value,'$[0]') AND json_array(${spec.columns})=expected.value))
		THEN 1 ELSE json('BOOKMARK_IMPORT_STATE_CHANGED') END ok`
				)
				.bind(key, userId, spec.rows.length, chunk, userId)
		)
	);
	if (guards.length > 20)
		throw new BookmarkImportError('现有导航数据超过在线核对范围，尚未执行导入。', 413);
	const mapping = new Map(preview.mappings.map((m) => [m.folder, m]));
	const links = preview.rows
		.filter((r) => r.selected)
		.map((r) => {
			const m = mapping.get(r.folder)!;
			return {
				title: r.title,
				url: r.url,
				categoryId: m.categoryId,
				name: m.target === 'new' ? m.name : null
			};
		});
	const categoryOrder = snapshot[0].rows.reduce(
		(n, r) => Math.max(n, Number(JSON.parse(r)[4]) || 0),
		0
	);
	const linkOrder = snapshot[1].rows.reduce(
		(n, r) => Math.max(n, Number(JSON.parse(r)[6]) || 0),
		0
	);
	if (
		!Number.isSafeInteger(categoryOrder + preview.newCategories.length * 10) ||
		!Number.isSafeInteger(linkOrder + links.length * 10)
	)
		throw new BookmarkImportError('现有排序值超出可用范围，请调整排序后重新预览。', 409);
	const writes: DatabaseStatement[] = [...guards];
	if (preview.newCategories.length)
		writes.push(
			db
				.prepare(
					`INSERT INTO custom_categories(user_id,name,sort_order)
		SELECT ?,value,?+(CAST(key AS INTEGER)+1)*10 FROM json_each(?)`
				)
				.bind(userId, categoryOrder, JSON.stringify(preview.newCategories))
		);
	let offset = 0;
	for (const chunk of jsonChunks(links, 400_000)) {
		writes.push(
			db
				.prepare(
					`INSERT INTO custom_links(user_id,category_id,title,url,sort_order,status)
		SELECT ?,COALESCE(d.value->>'$.categoryId',(SELECT id FROM custom_categories WHERE user_id=? AND name=d.value->>'$.name')),
		d.value->>'$.title',d.value->>'$.url',?+(CAST(d.key AS INTEGER)+1)*10,'active' FROM json_each(?) d`
				)
				.bind(userId, userId, linkOrder + offset * 10, chunk)
		);
		offset += JSON.parse(chunk).length;
	}
	const receipt: BookmarkReceipt = {
		digest: input.digest,
		status: 'completed',
		imported: links.length,
		categories: preview.newCategories.length,
		completedAt: new Date().toISOString()
	};
	writes.push(
		db
			.prepare('INSERT INTO settings(key,value_json) VALUES(?,?)')
			.bind(key, JSON.stringify(receipt))
	);
	try {
		await batch.call(db, writes);
	} catch {
		try {
			const done = await bookmarkImportReceipt(db, userId, input.runId);
			if (done) return matches(done, input.digest);
		} catch {
			/* Keep uncertainty if the receipt cannot be read. */
		}
		throw new BookmarkImportError(
			'导入结果尚未确认，请先核对本批次，不要直接重新提交。',
			503,
			true
		);
	}
	return receipt;
}
