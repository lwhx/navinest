import type { Database, DatabaseStatement } from '$lib/server/db';
import { validateExternalTarget } from '$lib/server/safe-target';
import { validateHotSourceFetchInput } from './hot-source-config';
import { hotErrorDetail, type HotErrorCode } from '$lib/hot-health';
import { assertPublicFetchTarget } from '$lib/server/services/web-enrichment';

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
export type HtmlParserConfig = {
	itemSelector?: string;
	titleSelector?: string;
	hotSelector?: string;
	baseUrl?: string;
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
		public readonly status = 400,
		public readonly code?: HotErrorCode
	) {
		super(message);
		this.name = 'HotNewsError';
	}
}
const maxResponseBytes = 2 * 1024 * 1024;
async function responseText(response: Response) {
	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > maxResponseBytes) {
		await response.body?.cancel();
		throw new HotNewsError('热点订阅响应过大。', 502, 'too_large');
	}
	if (!response.body) return '';
	const reader = response.body.getReader(),
		chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxResponseBytes) {
			await reader.cancel();
			throw new HotNewsError('热点订阅响应过大。', 502, 'too_large');
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(merged);
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
	return match
		? decode(match[1])
				.replace(/<[^>]+>/g, '')
				.trim()
		: '';
}
function tags(block: string, name: string) {
	return [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'gi'))]
		.map((match) =>
			decode(match[1])
				.replace(/<[^>]+>/g, '')
				.trim()
		)
		.filter(Boolean);
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
			const description =
				tag(block, atom ? 'summary' : 'description') ||
				tag(block, atom ? 'content' : 'content:encoded');
			const publishedAt =
				tag(block, atom ? 'published' : 'pubDate') || tag(block, atom ? 'updated' : 'dc:date');
			const author = atom
				? tag(tag(block, 'author') || block, 'name') || tag(block, 'author')
				: tag(block, 'dc:creator') || tag(block, 'author');
			const categories = tags(block, 'category');
			const item = safeItem(tag(block, 'title'), decode(link), null, index + 1);
			return item
				? {
						...item,
						extra: {
							...(description ? { description: description.slice(0, 500) } : {}),
							...(publishedAt ? { publishedAt: publishedAt.slice(0, 100) } : {}),
							...(author ? { author: author.slice(0, 100) } : {}),
							...(categories.length ? { categories: categories.slice(0, 10) } : {})
						}
					}
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
async function safeFetch(
	url: string,
	headers: Record<string, string>,
	fetcher: typeof fetch,
	resolveHost?: (hostname: string) => Promise<string[]>,
	signal?: AbortSignal
) {
	let current = url;
	for (let redirects = 0; redirects <= 3; redirects += 1) {
		current = await assertPublicFetchTarget(current, resolveHost);
		const response = await fetcher(current, { headers, redirect: 'manual', signal });
		if (response.status < 300 || response.status >= 400) return response;
		const location = response.headers.get('location');
		await response.body?.cancel();
		if (!location) throw new HotNewsError('热榜重定向缺少目标地址。', 502);
		const next = validateExternalTarget(new URL(location, current).toString());
		if (!next.valid) throw new HotNewsError('热榜重定向目标不安全。', 502);
		current = next.target;
	}
	throw new HotNewsError('热榜重定向次数过多。', 502);
}
function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Supports tag, .class and tag.class selectors; returns a regex whose `body` group holds the inner HTML. */
function elementPattern(selector: string) {
	const match = /^([a-z][a-z0-9-]*)?((?:\.[a-z0-9_-]+)*)$/i.exec(selector.trim());
	if (!match || (!match[1] && !match[2]))
		throw new HotNewsError('HTML 选择器格式无效，请使用 tag、.class 或 tag.class。');
	const tag = match[1]?.toLowerCase(),
		classes = match[2] ? match[2].slice(1).split('.') : [],
		guards = classes.map((name) => `(?=[^>]*class=["'][^"']*\\b${escapeRegExp(name)}\\b)`).join('');
	const open = tag ? `<${tag}\\b${guards}[^>]*>` : `<(?<tag>[a-z][a-z0-9-]*)\\b${guards}[^>]*>`,
		close = tag ? `<\\/${tag}>` : '</\\k<tag>>';
	return new RegExp(`(?<open>${open})(?<body>[\\s\\S]*?)${close}`, 'gi');
}
function elementMatch(block: string, selector: string) {
	const match = elementPattern(selector).exec(block);
	return match ? { open: match.groups?.open ?? '', body: match.groups?.body ?? '' } : null;
}
function entity(code: string, radix: number) {
	try {
		return String.fromCodePoint(parseInt(code, radix));
	} catch {
		return '';
	}
}
function text(value: string) {
	return decode(value)
		.replace(/&#x([0-9a-f]+);/gi, (_, code: string) => entity(code, 16))
		.replace(/&#(\d+);/g, (_, code: string) => entity(code, 10))
		.replace(/&nbsp;/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}
function anchorFromTag(openTag: string, inner: string) {
	const href = openTag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
	return href ? { url: decode(href[1]), title: text(inner) } : null;
}
function anchorOf(block: string) {
	const match = block.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
	return match ? anchorFromTag(match[1], match[2]) : null;
}
export function parseHotHtml(html: string, config: HtmlParserConfig = {}) {
	const itemSelector = (config.itemSelector ?? '').trim();
	if (!itemSelector) throw new HotNewsError('请先配置 HTML 条目选择器。');
	const base = (config.baseUrl ?? '').trim();
	const items: HotItem[] = [];
	for (const match of html.matchAll(elementPattern(itemSelector))) {
		if (items.length >= 100) break;
		const block = match.groups?.body ?? '';
		const scoped = config.titleSelector ? elementMatch(block, config.titleSelector) : null;
		const anchor =
			(scoped ? anchorFromTag(scoped.open, scoped.body) : null) ??
			anchorOf(scoped?.body ?? '') ??
			anchorOf(block);
		const title = anchor?.title || text(scoped?.body ?? '') || text(block);
		let url = anchor?.url ?? '';
		if (url && base) {
			try {
				url = new URL(url, base).toString();
			} catch {
				// keep the raw href when the configured base URL cannot be parsed
			}
		}
		const hot = config.hotSelector ? elementMatch(block, config.hotSelector)?.body : null;
		const item = safeItem(
			title,
			url,
			hot === null || hot === undefined ? null : text(hot),
			items.length + 1
		);
		if (item) items.push(item);
	}
	if (!items.length) throw new HotNewsError('HTML 页面未解析到有效条目。');
	return items.map((item, index) => ({ ...item, rank: index + 1 }));
}
export type HotFetchInput = {
	type: string;
	url: string;
	headers: Record<string, string>;
	parser: Record<string, string>;
};
export async function inspectHotSource(
	input: HotFetchInput,
	fetcher: typeof fetch = fetch,
	resolveHost?: (host: string) => Promise<string[]>
) {
	const validation = validateHotSourceFetchInput({
		type: input.type,
		url: input.url,
		headersJson: JSON.stringify(input.headers),
		parserJson: JSON.stringify(input.parser)
	});
	if (!validation.valid)
		throw new HotNewsError(Object.values(validation.errors).join(' '), 422, 'configuration');
	const controller = new AbortController(),
		timer = setTimeout(() => controller.abort(), 20000),
		started = Date.now();
	try {
		const response = await safeFetch(
			input.url,
			input.headers,
			fetcher,
			resolveHost,
			controller.signal
		);
		if (!response.ok) {
			await response.body?.cancel();
			throw new HotNewsError(`热榜请求失败：HTTP ${response.status}`, 502, 'http');
		}
		const contentType = (response.headers.get('content-type') ?? '未提供')
				.split(';')[0]
				.slice(0, 100),
			body = await responseText(response);
		let items: HotItem[];
		if (input.type === 'rss' && /^\s*(?:<!doctype\s+html|<html)/i.test(body))
			throw new HotNewsError(
				'订阅返回了网页，未检测到 RSS/Atom 内容，请核对地址及上游状态。',
				422,
				'parse'
			);
		try {
			items =
				input.type === 'json'
					? parseHotJson(JSON.parse(body), input.parser)
					: input.type === 'html'
						? parseHotHtml(body, input.parser)
						: parseHotRss(body);
		} catch (error) {
			if (error instanceof HotNewsError) throw new HotNewsError(error.message, 422, 'parse');
			throw new HotNewsError(
				'响应内容无法按所选格式解析，请检查订阅类型与字段配置。',
				422,
				'parse'
			);
		}
		if (!items.length)
			throw new HotNewsError('热榜没有有效条目，请检查标题、链接字段及上游内容。', 422, 'empty');
		return {
			items,
			count: items.length,
			contentType,
			latencyMs: Date.now() - started,
			checkedAt: new Date().toISOString()
		};
	} catch (error) {
		if (error instanceof HotNewsError) throw error;
		if (controller.signal.aborted)
			throw new HotNewsError('热榜请求超时，请稍后重试。', 504, 'timeout');
		if (error instanceof Error && /私网|保留地址|不安全|公网|凭据/.test(error.message))
			throw new HotNewsError(error.message, 400, 'unsafe');
		throw new HotNewsError('无法获取订阅内容，请检查地址和源站可用性。', 502, 'network');
	} finally {
		clearTimeout(timer);
	}
}
export function hotFailure(error: unknown) {
	const message =
		error instanceof HotNewsError ? error.message : '缓存写入失败，请稍后重试并核对结果。';
	return {
		error: message,
		...hotErrorDetail(message, error instanceof HotNewsError ? error.code : 'storage')
	};
}
export async function refreshHotSource(
	database: Database,
	id: number,
	fetcher: typeof fetch = fetch,
	resolveHost?: (hostname: string) => Promise<string[]>
) {
	const row = await source(database, id),
		token = crypto.randomUUID();
	const lease = (
		await database
			.prepare(
				"UPDATE hot_sources SET refresh_token=?,refresh_started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_fetch_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND (refresh_token IS NULL OR refresh_started_at IS NULL OR unixepoch(refresh_started_at)<unixepoch('now')-300) RETURNING id"
			)
			.bind(token, id)
			.all<{ id: number }>()
	).results[0];
	if (!lease) throw new HotNewsError('该榜单正在刷新，请稍后重试。', 409, 'conflict');
	try {
		let headers: Record<string, string>, parser: Record<string, string>;
		try {
			headers = JSON.parse(row.headers_json);
			parser = JSON.parse(row.parser_json);
			if (
				!headers ||
				typeof headers !== 'object' ||
				Array.isArray(headers) ||
				!parser ||
				typeof parser !== 'object' ||
				Array.isArray(parser)
			)
				throw new Error();
		} catch {
			throw new HotNewsError(
				'请求头或解析配置不是有效 JSON 对象，请编辑修正。',
				422,
				'configuration'
			);
		}
		const { items } = await inspectHotSource(
			{ type: row.type, url: row.url, headers, parser },
			fetcher,
			resolveHost
		);
		const batched = database as Database & {
			batch?: (statements: DatabaseStatement[]) => Promise<unknown>;
		};
		if (!batched.batch)
			throw new HotNewsError('当前数据库不支持原子刷新，旧缓存已保留。', 503, 'storage');
		const current =
			'id=? AND refresh_token=? AND type=? AND url=? AND headers_json=? AND parser_json=? AND is_enabled=?';
		await batched.batch([
			database
				.prepare(
					`SELECT CASE WHEN EXISTS(SELECT 1 FROM hot_sources WHERE ${current}) THEN 1 ELSE json('HOT_SOURCE_CHANGED') END`
				)
				.bind(id, token, row.type, row.url, row.headers_json, row.parser_json, row.is_enabled),
			database.prepare('DELETE FROM hot_items WHERE source_id=?').bind(id),
			database
				.prepare(
					"INSERT INTO hot_items(source_id,rank,title,url,hot_value,extra_json) SELECT ?,value->>'$.rank',value->>'$.title',value->>'$.url',value->>'$.hotValue',value->>'$.extraJson' FROM json_each(?)"
				)
				.bind(
					id,
					JSON.stringify(items.map((item) => ({ ...item, extraJson: JSON.stringify(item.extra) })))
				),
			database
				.prepare(
					"UPDATE hot_sources SET last_success_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_error=NULL,refresh_token=NULL,refresh_started_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND refresh_token=?"
				)
				.bind(id, token)
		]);
		return { sourceId: id, count: items.length };
	} catch (error) {
		const normalized =
			error instanceof Error && /HOT_SOURCE_CHANGED|malformed JSON/i.test(error.message)
				? new HotNewsError('配置或刷新状态已变化，请重新读取后重试。', 409, 'conflict')
				: error;
		const message = hotFailure(normalized).error;
		await database
			.prepare(
				'UPDATE hot_sources SET last_error=?,refresh_token=NULL,refresh_started_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND refresh_token=?'
			)
			.bind(message, id, token)
			.all();
		throw normalized;
	}
}
export async function refreshEnabledHotSources(
	database: Database,
	fetcher: typeof fetch = fetch,
	resolveHost?: (hostname: string) => Promise<string[]>
) {
	const rows = (
		await database
			.prepare(
				"SELECT id,CASE WHEN last_success_at IS NULL OR unixepoch(last_success_at)+cache_ttl<=unixepoch('now') THEN 1 ELSE 0 END is_due FROM hot_sources WHERE is_enabled=1 ORDER BY id"
			)
			.all<{ id: number; is_due: number }>()
	).results;
	const results = [];
	// Bound concurrency: one source cannot fan out a batch of requests or row-by-row writes.
	for (const { id, is_due } of rows) {
		if (is_due !== 1) {
			results.push({ ok: true as const, sourceId: id, count: 0, skipped: true as const });
			continue;
		}
		try {
			results.push({
				ok: true as const,
				...(await refreshHotSource(database, id, fetcher, resolveHost))
			});
		} catch (error) {
			results.push({ ok: false as const, sourceId: id, error: hotFailure(error).error });
		}
	}
	return results;
}
