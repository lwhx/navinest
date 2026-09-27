import type { Database, DatabaseStatement } from '$lib/server/db';
import { validateExternalTarget } from '$lib/server/safe-target';
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
		public readonly status = 400
	) {
		super(message);
		this.name = 'HotNewsError';
	}
}
const maxResponseBytes = 2 * 1024 * 1024;
async function responseText(response: Response) {
	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > maxResponseBytes) throw new HotNewsError('热点订阅响应过大。', 502);
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
			throw new HotNewsError('热点订阅响应过大。', 502);
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
	const open = tag ? `<${tag}\\b${guards}[^>]*>` : `(?<tag>[a-z][a-z0-9-]*)\\b${guards}[^>]*>`,
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
				"UPDATE hot_sources SET refresh_token=?,refresh_started_at=CURRENT_TIMESTAMP WHERE id=? AND (refresh_token IS NULL OR refresh_started_at<datetime('now','-5 minutes')) RETURNING id"
			)
			.bind(token, id)
			.all<{ id: number }>()
	).results[0];
	if (!lease) throw new HotNewsError('该榜单正在刷新，请稍后重试。', 409);
	const controller = new AbortController(),
		timeout = setTimeout(() => controller.abort(), 20_000);
	try {
		const headers = JSON.parse(row.headers_json) as Record<string, string>;
		const response = await safeFetch(row.url, headers, fetcher, resolveHost, controller.signal);
		if (!response.ok) throw new HotNewsError(`热榜请求失败：HTTP ${response.status}`, 502);
		const body = await responseText(response);
		const items =
			row.type === 'json'
				? parseHotJson(JSON.parse(body), JSON.parse(row.parser_json))
				: row.type === 'html'
					? parseHotHtml(body, JSON.parse(row.parser_json))
					: parseHotRss(body);
		if (!items.length) throw new HotNewsError('热榜没有有效条目。');
		const currentLease = (
			await database
				.prepare('SELECT id FROM hot_sources WHERE id=? AND refresh_token=? LIMIT 1')
				.bind(id, token)
				.all<{ id: number }>()
		).results[0];
		if (!currentLease) throw new HotNewsError('刷新租约已失效，请重试。', 409);
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
					'UPDATE hot_sources SET last_fetch_at=CURRENT_TIMESTAMP,last_success_at=CURRENT_TIMESTAMP,last_error=NULL,refresh_token=NULL,refresh_started_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND refresh_token=?'
				)
				.bind(id, token)
		];
		const batched = database as Database & {
			batch?: (statements: DatabaseStatement[]) => Promise<unknown>;
		};
		if (batched.batch) await batched.batch(statements);
		else for (const statement of statements) await statement.all();
		return { sourceId: id, count: items.length };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await database
			.prepare(
				'UPDATE hot_sources SET last_error=?,refresh_token=NULL,refresh_started_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND refresh_token=?'
			)
			.bind(message.slice(0, 500), id, token)
			.all();
		throw error;
	} finally {
		clearTimeout(timeout);
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
	return Promise.all(
		rows.map(async ({ id, is_due }) => {
			if (is_due !== 1)
				return { ok: true as const, sourceId: id, count: 0, skipped: true as const };
			try {
				return {
					ok: true as const,
					...(await refreshHotSource(database, id, fetcher, resolveHost))
				};
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
