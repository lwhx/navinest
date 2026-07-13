import type { Database, DatabaseStatement } from '$lib/server/db';
import { validateExternalTarget } from '$lib/server/safe-target';

export type HotItem = {
	rank: number;
	title: string;
	url: string;
	hotValue: string | null;
	extra: Record<string, unknown>;
};
export type JsonParserConfig = {
	itemsPath?: string;
	titleField?: string;
	urlField?: string;
	hotField?: string;
};
type SourceRow = {
	id: number;
	name: string;
	type: string;
	url: string;
	headers_json: string;
	parser_json: string;
	is_enabled: number;
};
export class HotNewsError extends Error {
	constructor(
		message: string,
		public readonly status = 400
	) {
		super(message);
		this.name = 'HotNewsError';
	}
}
function at(value: unknown, path: string) {
	return path
		.split('.')
		.filter(Boolean)
		.reduce<unknown>(
			(current, key) =>
				current && typeof current === 'object'
					? (current as Record<string, unknown>)[key]
					: undefined,
			value
		);
}
function safeItem(title: unknown, url: unknown, hot: unknown, rank: number): HotItem | null {
	const normalizedTitle = typeof title === 'string' ? title.trim() : '';
	const normalizedUrl = typeof url === 'string' ? url.trim() : '';
	if (!normalizedTitle || normalizedTitle.length > 300) return null;
	const target = validateExternalTarget(normalizedUrl);
	if (!target.valid) return null;
	return {
		rank,
		title: normalizedTitle,
		url: target.target,
		hotValue: hot === null || hot === undefined ? null : String(hot).slice(0, 100),
		extra: {}
	};
}
export function parseHotJson(value: unknown, config: JsonParserConfig = {}) {
	const items = at(value, config.itemsPath ?? '') ?? value;
	if (!Array.isArray(items)) throw new HotNewsError('JSON 热榜数组路径无效。');
	const titleField = config.titleField ?? 'title',
		urlField = config.urlField ?? 'url',
		hotField = config.hotField ?? 'hot';
	return items
		.slice(0, 100)
		.map((entry, index) =>
			entry && typeof entry === 'object'
				? safeItem(
						(entry as Record<string, unknown>)[titleField],
						(entry as Record<string, unknown>)[urlField],
						(entry as Record<string, unknown>)[hotField],
						index + 1
					)
				: null
		)
		.filter((item): item is HotItem => Boolean(item))
		.map((item, index) => ({ ...item, rank: index + 1 }));
}
function decode(value: string) {
	return value
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&')
		.trim();
}
function tag(block: string, name: string) {
	const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
	return match ? decode(match[1].replace(/<[^>]+>/g, '')) : '';
}
export function parseHotRss(xml: string) {
	const atom = /<feed(?:\s|>)/i.test(xml);
	const blocks = [
		...xml.matchAll(
			atom ? /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi : /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi
		)
	];
	const results = blocks
		.slice(0, 100)
		.map((match, index) => {
			const block = match[1];
			const link = atom
				? (block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] ?? tag(block, 'link'))
				: tag(block, 'link');
			const description = tag(block, atom ? 'summary' : 'description');
			const item = safeItem(tag(block, 'title'), decode(link), null, index + 1);
			return item
				? { ...item, extra: description ? { description: description.slice(0, 500) } : {} }
				: null;
		})
		.filter((item): item is HotItem => Boolean(item));
	if (!results.length) throw new HotNewsError('RSS/Atom 未解析到有效条目。');
	return results;
}
async function source(database: Database, id: number) {
	const row = (
		await database
			.prepare(
				'SELECT id,name,type,url,headers_json,parser_json,is_enabled FROM hot_sources WHERE id=? LIMIT 1'
			)
			.bind(id)
			.all<SourceRow>()
	).results[0];
	if (!row) throw new HotNewsError('热榜源不存在。', 404);
	return row;
}
async function safeFetch(url: string, headers: Record<string, string>, fetcher: typeof fetch) {
	let current = url;
	for (let redirects = 0; redirects <= 3; redirects += 1) {
		const response = await fetcher(current, { headers, redirect: 'manual' });
		if (response.status < 300 || response.status >= 400) return response;
		const location = response.headers.get('location');
		if (!location) throw new HotNewsError('热榜重定向缺少目标地址。', 502);
		const next = validateExternalTarget(new URL(location, current).toString());
		if (!next.valid) throw new HotNewsError('热榜重定向目标不安全。', 502);
		current = next.target;
	}
	throw new HotNewsError('热榜重定向次数过多。', 502);
}
export async function refreshHotSource(
	database: Database,
	id: number,
	fetcher: typeof fetch = fetch
) {
	const row = await source(database, id);
	const headers = JSON.parse(row.headers_json) as Record<string, string>;
	const response = await safeFetch(row.url, headers, fetcher);
	if (!response.ok) throw new HotNewsError(`热榜请求失败：HTTP ${response.status}`, 502);
	const items =
		row.type === 'json'
			? parseHotJson(await response.json(), JSON.parse(row.parser_json))
			: parseHotRss(await response.text());
	if (!items.length) throw new HotNewsError('热榜没有有效条目。');
	const statements: DatabaseStatement[] = [
		database.prepare('DELETE FROM hot_items WHERE source_id=?').bind(id),
		...items.map((item) =>
			database
				.prepare(
					'INSERT INTO hot_items(source_id,rank,title,url,hot_value,extra_json) VALUES(?,?,?,?,?,?)'
				)
				.bind(id, item.rank, item.title, item.url, item.hotValue, JSON.stringify(item.extra))
		),
		database
			.prepare(
				'UPDATE hot_sources SET last_fetch_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?'
			)
			.bind(id)
	];
	const batched = database as Database & {
		batch?: (statements: DatabaseStatement[]) => Promise<unknown>;
	};
	if (batched.batch) await batched.batch(statements);
	else for (const statement of statements) await statement.all();
	return { sourceId: id, count: items.length };
}
export async function refreshEnabledHotSources(database: Database, fetcher: typeof fetch = fetch) {
	const rows = (
		await database
			.prepare('SELECT id FROM hot_sources WHERE is_enabled=1 ORDER BY id')
			.all<{ id: number }>()
	).results;
	return Promise.all(
		rows.map(async ({ id }) => {
			try {
				return { ok: true as const, ...(await refreshHotSource(database, id, fetcher)) };
			} catch (error) {
				return {
					ok: false as const,
					sourceId: id,
					error: error instanceof Error ? error.message : String(error)
				};
			}
		})
	);
}
