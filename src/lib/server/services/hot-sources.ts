import type { Database } from '$lib/server/db';
import { validateExternalTarget } from '$lib/server/safe-target';

export type HotSourceInput = {
	name: string;
	type: 'json' | 'rss';
	url: string;
	headers: Record<string, string>;
	parser: Record<string, string>;
	cacheTtl: number;
	isEnabled: boolean;
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
	const type = input.type === 'rss' ? 'rss' : input.type === 'json' ? 'json' : null;
	if (!type) errors.type = '类型必须是 JSON 或 RSS。';
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
	for (const [key, value] of Object.entries(rawParser)) {
		if (
			!['itemsPath', 'titleField', 'urlField', 'hotField'].includes(key) ||
			typeof value !== 'string' ||
			value.length > 100
		) {
			errors.parserJson = '解析配置字段无效。';
			break;
		}
		if (value) parser[key] = value;
	}
	const cacheTtl = Number(input.cacheTtl ?? 900);
	if (!Number.isInteger(cacheTtl) || cacheTtl < 60 || cacheTtl > 86400)
		errors.cacheTtl = '缓存时间必须为 60 到 86400 秒。';
	const data: HotSourceInput = {
		name,
		type: type ?? 'json',
		url: target.valid ? target.target : url,
		headers,
		parser,
		cacheTtl,
		isEnabled: input.isEnabled === true || input.isEnabled === 'on' || input.isEnabled === 1
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
				`SELECT id,name,type,url,headers_json,parser_json,cache_ttl,is_enabled,last_fetch_at FROM hot_sources ${enabledOnly ? 'WHERE is_enabled=1' : ''} ORDER BY name,id`
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
		lastFetchAt: row.last_fetch_at
	}));
}
export async function createHotSource(database: Database, input: HotSourceInput) {
	const row = (
		await database
			.prepare(
				'INSERT INTO hot_sources(name,type,url,headers_json,parser_json,cache_ttl,is_enabled) VALUES(?,?,?,?,?,?,?) RETURNING id'
			)
			.bind(
				input.name,
				input.type,
				input.url,
				JSON.stringify(input.headers),
				JSON.stringify(input.parser),
				input.cacheTtl,
				input.isEnabled ? 1 : 0
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
				'UPDATE hot_sources SET name=?,type=?,url=?,headers_json=?,parser_json=?,cache_ttl=?,is_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id'
			)
			.bind(
				input.name,
				input.type,
				input.url,
				JSON.stringify(input.headers),
				JSON.stringify(input.parser),
				input.cacheTtl,
				input.isEnabled ? 1 : 0,
				id
			)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new HotSourceWriteError('热榜源不存在。');
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
