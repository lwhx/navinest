import type { Database } from '$lib/server/db';
import { validateExternalTarget } from '$lib/server/safe-target';
import { backupDigest } from './site-backup-state';
import type { NavigationData } from '$lib/custom-navigation-workspace';

export const customNavigationVersion = (navigation: NavigationData) =>
	backupDigest({ categories: navigation.categories, links: navigation.links });

export type CustomCategoryInput = { name: string; icon: string | null; sortOrder: number };
export type CustomLinkInput = {
	categoryId: number | null;
	title: string;
	url: string;
	summary: string | null;
	sortOrder: number;
	status: 'active' | 'inactive';
};
export class CustomNavigationError extends Error {
	constructor(
		message: string,
		public readonly field?: string,
		public readonly status: 400 | 404 = 400
	) {
		super(message);
		this.name = 'CustomNavigationError';
	}
}
type IdRow = { id: number };
type CategoryRow = { id: number; name: string; icon: string | null; sort_order: number };
type LinkRow = {
	id: number;
	category_id: number | null;
	title: string;
	url: string;
	summary: string | null;
	sort_order: number;
	status: string;
};
function text(value: string, label: string, max: number) {
	const normalized = value.trim();
	if (!normalized) throw new CustomNavigationError(`${label}不能为空。`);
	if (normalized.length > max) throw new CustomNavigationError(`${label}不能超过 ${max} 个字符。`);
	return normalized;
}
function order(value: number) {
	return Number.isFinite(value) ? Math.trunc(value) : 0;
}
export function categoryInput(input: CustomCategoryInput): CustomCategoryInput {
	return {
		name: text(input.name, '分类名称', 80),
		icon: input.icon?.trim().slice(0, 80) || null,
		sortOrder: order(input.sortOrder)
	};
}
export function linkInput(input: CustomLinkInput): CustomLinkInput {
	const target = validateExternalTarget(input.url);
	if (!target.valid) throw new CustomNavigationError(target.reason, 'url');
	if (input.status !== 'active' && input.status !== 'inactive')
		throw new CustomNavigationError('链接状态无效。', 'status');
	return {
		categoryId: input.categoryId,
		title: text(input.title, '链接标题', 120),
		url: target.target,
		summary: input.summary?.trim().slice(0, 300) || null,
		sortOrder: order(input.sortOrder),
		status: input.status
	};
}
async function ownedCategory(database: Database, userId: number, id: number | null) {
	if (id === null) return;
	const row = (
		await database
			.prepare('SELECT id FROM custom_categories WHERE id=? AND user_id=? LIMIT 1')
			.bind(id, userId)
			.all<IdRow>()
	).results[0];
	if (!row) throw new CustomNavigationError('分类不存在或不属于当前用户。', 'categoryId', 404);
}
async function returnedId(statement: ReturnType<Database['prepare']>, message: string) {
	const id = (await statement.all<IdRow>()).results[0]?.id;
	if (!id) throw new CustomNavigationError(message, undefined, 404);
	return id;
}
export async function listCustomNavigation(database: Database, userId: number) {
	const [categories, links] = await Promise.all([
		database
			.prepare(
				'SELECT id,name,icon,sort_order FROM custom_categories WHERE user_id=? ORDER BY sort_order ASC,id ASC'
			)
			.bind(userId)
			.all<CategoryRow>(),
		database
			.prepare(
				'SELECT id,category_id,title,url,summary,sort_order,status FROM custom_links WHERE user_id=? ORDER BY sort_order ASC,id ASC'
			)
			.bind(userId)
			.all<LinkRow>()
	]);
	const navigation = {
		categories: categories.results.map((row) => ({
			id: row.id,
			name: row.name,
			icon: row.icon,
			sortOrder: row.sort_order
		})),
		links: links.results.map((row) => ({
			id: row.id,
			categoryId: row.category_id,
			title: row.title,
			url: row.url,
			summary: row.summary,
			sortOrder: row.sort_order,
			status: row.status as 'active' | 'inactive'
		}))
	};
	return { ...navigation, version: await customNavigationVersion(navigation) };
}

export async function createCustomCategory(
	database: Database,
	userId: number,
	input: CustomCategoryInput
) {
	const data = categoryInput(input);
	return returnedId(
		database
			.prepare(
				'INSERT INTO custom_categories(user_id,name,icon,sort_order) VALUES(?,?,?,?) RETURNING id'
			)
			.bind(userId, data.name, data.icon, data.sortOrder),
		'分类创建失败。'
	);
}
export async function updateCustomCategory(
	database: Database,
	userId: number,
	id: number,
	input: CustomCategoryInput
) {
	const data = categoryInput(input);
	await returnedId(
		database
			.prepare(
				'UPDATE custom_categories SET name=?,icon=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? RETURNING id'
			)
			.bind(data.name, data.icon, data.sortOrder, id, userId),
		'分类不存在。'
	);
}
export async function deleteCustomCategory(database: Database, userId: number, id: number) {
	await returnedId(
		database
			.prepare('DELETE FROM custom_categories WHERE id=? AND user_id=? RETURNING id')
			.bind(id, userId),
		'分类不存在。'
	);
}
export async function createCustomLink(database: Database, userId: number, input: CustomLinkInput) {
	const data = linkInput(input);
	await ownedCategory(database, userId, data.categoryId);
	return returnedId(
		database
			.prepare(
				'INSERT INTO custom_links(user_id,category_id,title,url,summary,sort_order,status) VALUES(?,?,?,?,?,?,?) RETURNING id'
			)
			.bind(
				userId,
				data.categoryId,
				data.title,
				data.url,
				data.summary,
				data.sortOrder,
				data.status
			),
		'链接创建失败。'
	);
}
export async function updateCustomLink(
	database: Database,
	userId: number,
	id: number,
	input: CustomLinkInput
) {
	const data = linkInput(input);
	await ownedCategory(database, userId, data.categoryId);
	await returnedId(
		database
			.prepare(
				'UPDATE custom_links SET category_id=?,title=?,url=?,summary=?,sort_order=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? RETURNING id'
			)
			.bind(
				data.categoryId,
				data.title,
				data.url,
				data.summary,
				data.sortOrder,
				data.status,
				id,
				userId
			),
		'链接不存在。'
	);
}
export async function deleteCustomLink(database: Database, userId: number, id: number) {
	await returnedId(
		database
			.prepare('DELETE FROM custom_links WHERE id=? AND user_id=? RETURNING id')
			.bind(id, userId),
		'链接不存在。'
	);
}

type ReorderTable = 'custom_links' | 'custom_categories';

async function applyOrder(database: Database, userId: number, table: ReorderTable, ids: number[]) {
	const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
	if (!unique.length) throw new CustomNavigationError('排序列表为空。');
	if (unique.length > 500) throw new CustomNavigationError('一次最多调整 500 条记录。');
	const owned = new Set(
		(
			await database.prepare(`SELECT id FROM ${table} WHERE user_id=?`).bind(userId).all<IdRow>()
		).results.map((row) => row.id)
	);
	if (unique.some((id) => !owned.has(id)))
		throw new CustomNavigationError('排序列表包含不属于当前用户的记录。', undefined, 404);
	for (const [index, id] of unique.entries())
		await database
			.prepare(
				`UPDATE ${table} SET sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`
			)
			.bind((index + 1) * 10, id, userId)
			.all();
	return unique.length;
}

/** Persists a new ordering for the given records, spacing sort_order by ten. */
export function reorderCustomLinks(database: Database, userId: number, ids: number[]) {
	return applyOrder(database, userId, 'custom_links', ids);
}

export function reorderCustomCategories(database: Database, userId: number, ids: number[]) {
	return applyOrder(database, userId, 'custom_categories', ids);
}
