import { CustomNavigationError } from './custom-navigation';
import { validateExternalTarget } from '$lib/server/safe-target';
import { BOOKMARK_MAX_BYTES, BOOKMARK_MAX_ENTRIES, type BookmarkRow } from '$lib/bookmark-import';

export const MAX_BOOKMARK_BYTES = BOOKMARK_MAX_BYTES;
export const MAX_BOOKMARK_ENTRIES = BOOKMARK_MAX_ENTRIES;
export type BookmarkEntry = { title: string; url: string; folder: string | null };
const tokens =
	/<dl\b[^>]*>|<\/dl\s*>|<h3\b[^>]*>([\s\S]*?)<\/h3\s*>|<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
function entities(value: string) {
	return value.replace(
		/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
		(original, code: string) => {
			const named: Record<string, string> = {
				amp: '&',
				lt: '<',
				gt: '>',
				quot: '"',
				apos: "'",
				nbsp: ' '
			};
			if (!code.startsWith('#')) return named[code.toLowerCase()] ?? original;
			const number = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : Number(code.slice(1));
			return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
				? String.fromCodePoint(number)
				: '\uFFFD';
		}
	);
}
const text = (value: string) => entities(value.replace(/<[^>]*>/g, '')).trim();

// Compare the complete canonical URL. Query parameters, fragments and meaningful trailing slashes stay distinct.
export function bookmarkUrlKey(url: string) {
	try {
		return new URL(url).href;
	} catch {
		return url.trim();
	}
}
export function parseBookmarkDocument(html: unknown): BookmarkRow[] {
	if (typeof html !== 'string' || !html.trim())
		throw new CustomNavigationError('请提供书签文件内容。');
	if (new TextEncoder().encode(html).byteLength > BOOKMARK_MAX_BYTES)
		throw new CustomNavigationError('书签文件过大，请导出为 2 MiB 以内的 HTML。');
	const rows: BookmarkRow[] = [],
		folders: string[] = [];
	let pending = '';
	for (const match of html.matchAll(tokens)) {
		if (/^<\/dl/i.test(match[0])) {
			folders.pop();
			continue;
		}
		if (/^<dl/i.test(match[0])) {
			if (folders.length >= 64)
				throw new CustomNavigationError('书签文件夹层级过深，请整理后重试。');
			folders.push(pending);
			pending = '';
			continue;
		}
		if (/^<h3/i.test(match[0])) {
			pending = text(match[1] ?? '').slice(0, 160);
			continue;
		}
		if (rows.length >= BOOKMARK_MAX_ENTRIES)
			throw new CustomNavigationError('书签超过 5000 条，请分成较小的文件，文件未导入。');
		const href = (match[2] ?? '').match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
		const raw = entities((href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim());
		const target = validateExternalTarget(raw);
		const folder = folders.filter(Boolean).join(' / ');
		const error =
			folder.length > 512
				? '文件夹路径超过 512 个字符，请整理后重试。'
				: raw.length > 2048
					? '网址超过 2048 个字符。'
					: target.valid
						? ''
						: target.reason;
		rows.push({
			id: rows.length,
			title: text(match[3] ?? '').slice(0, 120) || (target.valid ? target.host : '无标题书签'),
			url: !error && target.valid ? target.target : raw.slice(0, 2048),
			folder: folder.slice(0, 512),
			error,
			status: error ? 'invalid' : 'new',
			selected: false
		});
	}
	if (!rows.length) throw new CustomNavigationError('没有在文件中找到可导入的书签链接。');
	return rows;
}
export function parseBookmarkHtml(html: unknown) {
	const rows = parseBookmarkDocument(html);
	return {
		entries: rows
			.filter((r) => !r.error)
			.map((r) => ({ title: r.title, url: r.url, folder: r.folder || null })),
		skipped: rows.filter((r) => r.error).length
	};
}
