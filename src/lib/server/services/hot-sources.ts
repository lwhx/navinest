import type { Database, DatabaseStatement } from '$lib/server/db';
import { validateExternalTarget } from '$lib/server/safe-target';

export type HotSourceInput = {
	name: string;
	type: 'json' | 'rss' | 'html';
	url: string;
	headers: Record<string, string>;
	parser: Record<string, string>;
	cacheTtl: number;
	isEnabled: boolean;
	slug: string;
	description: string;
	icon: string;
	accentColor: string;
	surfaceColor: string;
	displayLimit: number;
	layout: 'list' | 'compact' | 'columns';
	sortOrder: number;
	showDescription: boolean;
};
type Raw = Record<string, unknown>;
const forbidden = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key']);
function objectJson(value: unknown, field: string, errors: Record<string, string>) {
	try {
		const parsed = JSON.parse(typeof value === 'string' && value.trim() ? value : '{}');
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
		return parsed as Record<string, unknown>;
	} catch {
		errors[field] = '请输入有效的 JSON 对象。';
		return {};
	}
}
export function validateHotSourceInput(
	input: Raw
): { valid: true; data: HotSourceInput } | { valid: false; errors: Record<string, string> } {
	const errors: Record<string, string> = {};
	const name = typeof input.name === 'string' ? input.name.trim() : '';
	if (!name) errors.name = '名称不能为空。';
	else if (name.length > 100) errors.name = '名称不能超过 100 个字符。';
	const fallbackSlug = name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, ''),
		slug = (typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '') || fallbackSlug;
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80)
		errors.slug = '标识只能使用小写字母、数字和连字符。';
	const description = typeof input.description === 'string' ? input.description.trim() : '';
	if (description.length > 300) errors.description = '说明不能超过 300 个字符。';
	const icon = typeof input.icon === 'string' ? input.icon.trim() : '热';
	if (!icon || Array.from(icon).length > 4) errors.icon = '图标请输入 1 到 4 个字符。';
	function color(value: unknown, fallback: string, field: string) {
		const normalized =
			typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : fallback;
		if (!/^#[0-9a-f]{6}$/.test(normalized)) errors[field] = '请输入 #RRGGBB 格式颜色。';
		return normalized;
	}
	const accentColor = color(input.accentColor, '#e5484d', 'accentColor'),
		surfaceColor = color(input.surfaceColor, '#fff7f7', 'surfaceColor');
	const type =
		input.type === 'rss'
			? 'rss'
			: input.type === 'json'
				? 'json'
				: input.type === 'html'
					? 'html'
					: null;
	if (!type) errors.type = '类型必须是 JSON、RSS 或 HTML。';
	const url = typeof input.url === 'string' ? input.url.trim() : '';
	const target = validateExternalTarget(url);
	if (!target.valid) errors.url = '请输入有效的公网 HTTP/HTTPS 地址。';
	const rawHeaders = objectJson(input.headersJson, 'headersJson', errors),
		headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(rawHeaders)) {
		if (
			forbidden.has(key.toLowerCase()) ||
			typeof value !== 'string' ||
			key.length > 100 ||
			value.length > 1000
		) {
			errors.headersJson = '请求头不能包含凭据，且键值必须为字符串。';
			break;
		}
		headers[key] = value;
	}
	const rawParser = objectJson(input.parserJson, 'parserJson', errors),
		parser: Record<string, string> = {};
	const parserKeys =
		type === 'html'
			? ['itemSelector', 'titleSelector', 'hotSelector', 'baseUrl']
			: ['itemsPath', 'titleField', 'urlField', 'hotField'];
	for (const [key, value] of Object.entries(rawParser)) {
		if (
			!parserKeys.includes(key) ||
			typeof value !== 'string' ||
			value.length > (key === 'baseUrl' ? 200 : 100)
		) {
			errors.parserJson =
				type === 'html'
					? 'HTML 解析配置仅支持 itemSelector、titleSelector、hotSelector 与 baseUrl。'
					: '解析配置字段无效。';
			break;
		}
		if (value) parser[key] = value;
	}
	if (type === 'html' && !parser.itemSelector)
		errors.parserJson = 'HTML 榜单必须配置 itemSelector。';
	const cacheTtl = Number(input.cacheTtl ?? 900);
	if (!Number.isInteger(cacheTtl) || cacheTtl < 60 || cacheTtl > 86400)
		errors.cacheTtl = '缓存时间必须为 60 到 86400 秒。';
	const displayLimit = Number(input.displayLimit ?? 20);
	if (!Number.isInteger(displayLimit) || displayLimit < 5 || displayLimit > 50)
		errors.displayLimit = '显示条数必须为 5 到 50。';
	const layout =
		input.layout === 'compact' || input.layout === 'columns' || input.layout === 'list'
			? input.layout
			: 'list';
	const sortOrder = Number(input.sortOrder ?? 0);
	if (!Number.isInteger(sortOrder) || sortOrder < -10000 || sortOrder > 10000)
		errors.sortOrder = '排序必须是 -10000 到 10000 的整数。';
	const data: HotSourceInput = {
		name,
		type: type ?? 'json',
		url: target.valid ? target.target : url,
		headers,
		parser,
		cacheTtl,
		isEnabled: input.isEnabled === true || input.isEnabled === 'on' || input.isEnabled === 1,
		slug,
		description,
		icon,
		accentColor,
		surfaceColor,
		displayLimit,
		layout,
		sortOrder,
		showDescription:
			input.showDescription === true ||
			input.showDescription === 'on' ||
			input.showDescription === 1
	};
	return Object.keys(errors).length ? { valid: false, errors } : { valid: true, data };
}
export class HotSourceWriteError extends Error {
	constructor(
		message: string,
		public readonly status = 404
	) {
		super(message);
		this.name = 'HotSourceWriteError';
	}
}
export async function listHotSources(database: Database, enabledOnly = false) {
	const rows = (
		await database
			.prepare(
				`SELECT id,name,type,url,headers_json,parser_json,cache_ttl,is_enabled,last_fetch_at,slug,description,icon,accent_color,surface_color,display_limit,layout,sort_order,show_description,last_error,last_success_at FROM hot_sources ${enabledOnly ? 'WHERE is_enabled=1' : ''} ORDER BY sort_order,id`
			)
			.all<{
				id: number;
				name: string;
				type: string;
				url: string;
				headers_json: string;
				parser_json: string;
				cache_ttl: number;
				is_enabled: number;
				last_fetch_at: string | null;
				slug: string;
				description: string;
				icon: string;
				accent_color: string;
				surface_color: string;
				display_limit: number;
				layout: string;
				sort_order: number;
				show_description: number;
				last_error: string | null;
				last_success_at: string | null;
			}>()
	).results;
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		type: row.type,
		url: row.url,
		headers: JSON.parse(row.headers_json),
		parser: JSON.parse(row.parser_json),
		cacheTtl: row.cache_ttl,
		isEnabled: row.is_enabled === 1,
		lastFetchAt: row.last_fetch_at,
		slug: row.slug,
		description: row.description,
		icon: row.icon,
		accentColor: row.accent_color,
		surfaceColor: row.surface_color,
		displayLimit: row.display_limit,
		layout: row.layout,
		sortOrder: row.sort_order,
		showDescription: row.show_description === 1,
		lastError: row.last_error,
		lastSuccessAt: row.last_success_at
	}));
}
export async function createHotSource(database: Database, input: HotSourceInput) {
	const row = (
		await database
			.prepare(
				'INSERT INTO hot_sources(name,type,url,headers_json,parser_json,cache_ttl,is_enabled,slug,description,icon,accent_color,surface_color,display_limit,layout,sort_order,show_description) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id'
			)
			.bind(
				input.name,
				input.type,
				input.url,
				JSON.stringify(input.headers),
				JSON.stringify(input.parser),
				input.cacheTtl,
				input.isEnabled ? 1 : 0,
				input.slug,
				input.description,
				input.icon,
				input.accentColor,
				input.surfaceColor,
				input.displayLimit,
				input.layout,
				input.sortOrder,
				input.showDescription ? 1 : 0
			)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new HotSourceWriteError('热榜源创建失败。');
	return row.id;
}
export async function updateHotSource(database: Database, id: number, input: HotSourceInput) {
	const row = (
		await database
			.prepare(
				'UPDATE hot_sources SET name=?,type=?,url=?,headers_json=?,parser_json=?,cache_ttl=?,is_enabled=?,slug=?,description=?,icon=?,accent_color=?,surface_color=?,display_limit=?,layout=?,sort_order=?,show_description=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id'
			)
			.bind(
				input.name,
				input.type,
				input.url,
				JSON.stringify(input.headers),
				JSON.stringify(input.parser),
				input.cacheTtl,
				input.isEnabled ? 1 : 0,
				input.slug,
				input.description,
				input.icon,
				input.accentColor,
				input.surfaceColor,
				input.displayLimit,
				input.layout,
				input.sortOrder,
				input.showDescription ? 1 : 0,
				id
			)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new HotSourceWriteError('热榜源不存在。');
}
export async function moveHotSource(database: Database, id: number, direction: 'up' | 'down') {
	const rows = (
		await database
			.prepare('SELECT id FROM hot_sources ORDER BY sort_order,id')
			.all<{ id: number }>()
	).results;
	const index = rows.findIndex((row) => row.id === id);
	if (index < 0) throw new HotSourceWriteError('热榜源不存在。');
	const target = direction === 'up' ? index - 1 : index + 1;
	if (target < 0 || target >= rows.length) return false;
	[rows[index], rows[target]] = [rows[target], rows[index]];
	const batched = database as Database & {
		batch?: (statements: DatabaseStatement[]) => Promise<unknown>;
	};
	if (!batched.batch) throw new HotSourceWriteError('当前数据库不支持原子排序。', 500);
	await batched.batch(
		rows.map((row, position) =>
			database
				.prepare('UPDATE hot_sources SET sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
				.bind((position + 1) * 10, row.id)
		)
	);
	return true;
}

export async function deleteHotSource(database: Database, id: number) {
	const row = (
		await database
			.prepare('DELETE FROM hot_sources WHERE id=? RETURNING id')
			.bind(id)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new HotSourceWriteError('热榜源不存在。');
}
