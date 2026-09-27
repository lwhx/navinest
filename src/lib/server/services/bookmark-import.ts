import type { Database } from '$lib/server/db';
import { CustomNavigationError } from '$lib/server/services/custom-navigation';
import { validateExternalTarget } from '$lib/server/safe-target';

export const MAX_BOOKMARK_BYTES = 2 * 1024 * 1024;
export const MAX_BOOKMARK_ENTRIES = 5000;
export const IMPORT_LIMIT = 500;

export type BookmarkEntry = { title: string; url: string; folder: string | null };
export type BookmarkParseResult = { entries: BookmarkEntry[]; skipped: number };

const TOKEN_PATTERN =
	/<dl\b[^>]*>|<\/dl\s*>|<h3\b[^>]*>([\s\S]*?)<\/h3\s*>|<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;

function decodeEntities(value: string) {
	return value
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.trim();
}

/** Parses Netscape bookmark exports (Chrome, Edge, Firefox, Safari) into flat link entries. */
export function parseBookmarkHtml(html: unknown): BookmarkParseResult {
	if (typeof html !== 'string' || !html.trim())
		throw new CustomNavigationError('请提供书签文件内容。');
	if (html.length > MAX_BOOKMARK_BYTES)
		throw new CustomNavigationError('书签文件过大，请导出为 2 MiB 以内的 HTML。');
	const entries: BookmarkEntry[] = [];
	const folders: string[] = [];
	let pendingFolder: string | null = null;
	let skipped = 0;
	for (const match of html.matchAll(TOKEN_PATTERN)) {
		const token = match[0];
		if (/^<\/dl/i.test(token)) {
			folders.pop();
			continue;
		}
		if (/^<dl/i.test(token)) {
			folders.push(pendingFolder ?? '');
			pendingFolder = null;
			continue;
		}
		if (/^<h3/i.test(token)) {
			pendingFolder = decodeEntities(match[1] ?? '').slice(0, 80) || null;
			continue;
		}
		const raw = (match[2] ?? match[3] ?? match[4] ?? '').trim();
		const target = validateExternalTarget(raw);
		if (!target.valid) {
			skipped += 1;
			continue;
		}
		const title = decodeEntities(match[5] ?? '').slice(0, 120) || target.host;
		const folder = folders.filter(Boolean).join(' / ').slice(0, 160) || null;
		entries.push({ title, url: target.target, folder });
		if (entries.length >= MAX_BOOKMARK_ENTRIES) break;
	}
	if (!entries.length && !skipped)
		throw new CustomNavigationError('没有在文件中找到可导入的书签链接。');
	return { entries, skipped };
}

export type BookmarkImportResult = {
	imported: number;
	duplicates: number;
	skipped: number;
	limited: number;
	folders: string[];
};

export function bookmarkUrlKey(url: string) {
	try {
		const parsed = new URL(url);
		const path = parsed.pathname.replace(/\/+$/, '');
		return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
	} catch {
		return url.trim().toLowerCase();
	}
}

/** Imports parsed bookmarks as custom links, creating one category per bookmark folder. */
export async function importBookmarks(
	database: Database,
	userId: number,
	entries: BookmarkEntry[],
	options: { limit?: number; skipped?: number } = {}
): Promise<BookmarkImportResult> {
	const limit = options.limit ?? IMPORT_LIMIT;
	const known = new Set(
		(
			await database
				.prepare('SELECT url FROM custom_links WHERE user_id=?')
				.bind(userId)
				.all<{ url: string }>()
		).results.map((row) => bookmarkUrlKey(row.url))
	);
	const categoryIds = new Map(
		(
			await database
				.prepare('SELECT id,name FROM custom_categories WHERE user_id=?')
				.bind(userId)
				.all<{ id: number; name: string }>()
		).results.map((row) => [row.name, row.id])
	);
	let order = Number(
		(
			await database
				.prepare('SELECT COALESCE(MAX(sort_order),0) value FROM custom_links WHERE user_id=?')
				.bind(userId)
				.all<{ value: number }>()
		).results[0]?.value ?? 0
	);
	const folders: string[] = [];
	let imported = 0;
	let duplicates = 0;
	let limited = 0;
	let invalid = 0;
	for (const entry of entries) {
		const key = bookmarkUrlKey(entry.url);
		if (known.has(key)) {
			duplicates += 1;
			continue;
		}
		if (imported >= limit) {
			limited += 1;
			continue;
		}
		const target = validateExternalTarget(entry.url);
		if (!target.valid) {
			invalid += 1;
			continue;
		}
		let categoryId: number | null = null;
		if (entry.folder) {
			categoryId = categoryIds.get(entry.folder) ?? null;
			if (!categoryId) {
				const created = (
					await database
						.prepare(
							'INSERT INTO custom_categories(user_id,name,icon,sort_order) VALUES(?,?,?,?) RETURNING id'
						)
						.bind(userId, entry.folder, null, folders.length * 10)
						.all<{ id: number }>()
				).results[0];
				categoryId = created?.id ?? null;
				if (categoryId) {
					categoryIds.set(entry.folder, categoryId);
					folders.push(entry.folder);
				}
			}
		}
		order += 10;
		await database
			.prepare(
				'INSERT INTO custom_links(user_id,category_id,title,url,summary,sort_order,status) VALUES(?,?,?,?,?,?,?)'
			)
			.bind(userId, categoryId, entry.title, target.target, null, order, 'active')
			.all();
		known.add(key);
		imported += 1;
	}
	return { imported, duplicates, skipped: (options.skipped ?? 0) + invalid, limited, folders };
}
