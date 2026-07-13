import type { Database } from '$lib/server/db';

type Row = {
	kind: 'category' | 'tag' | 'item';
	type: string | null;
	slug: string;
	updated_at: string | null;
};
export type SitemapEntry = { url: string; lastmod: string | null };
const prefixes: Record<string, string> = {
	site: 'sites',
	post: 'posts',
	app: 'apps',
	book: 'books',
	bulletin: 'bulletins'
};
function absolute(base: string, path: string) {
	return `${base.replace(/\/$/, '')}${path}`;
}
export async function listSitemapEntries(
	database: Database,
	baseUrl: string
): Promise<SitemapEntry[]> {
	const staticEntries: SitemapEntry[] = [
		{ url: absolute(baseUrl, '/'), lastmod: null },
		{ url: absolute(baseUrl, '/hotnews'), lastmod: null },
		{ url: absolute(baseUrl, '/rankings'), lastmod: null }
	];
	const rows = (
		await database
			.prepare(
				`SELECT kind,type,slug,updated_at FROM (SELECT 1 sort_order,0 type_order,'category' kind,type,slug,updated_at FROM categories WHERE is_visible=1 UNION ALL SELECT 2 sort_order,0 type_order,'tag' kind,type,slug,updated_at FROM tags UNION ALL SELECT 3 sort_order,CASE type WHEN 'site' THEN 1 WHEN 'post' THEN 2 WHEN 'app' THEN 3 WHEN 'book' THEN 4 WHEN 'bulletin' THEN 5 ELSE 99 END type_order,'item' kind,type,slug,updated_at FROM items WHERE status='published' AND visibility='public') ORDER BY sort_order,type_order,slug`
			)
			.all<Row>()
	).results;
	const dynamic = rows.flatMap((row) => {
		const slug = encodeURIComponent(row.slug);
		if (row.kind === 'category')
			return [{ url: absolute(baseUrl, `/categories/${slug}`), lastmod: row.updated_at }];
		if (row.kind === 'tag')
			return [{ url: absolute(baseUrl, `/tags/${slug}`), lastmod: row.updated_at }];
		const prefix = row.type ? prefixes[row.type] : null;
		return prefix
			? [{ url: absolute(baseUrl, `/${prefix}/${slug}`), lastmod: row.updated_at }]
			: [];
	});
	return [...staticEntries, ...dynamic];
}
function escapeXml(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
function normalizeLastmod(value: string | null) {
	if (!value) return null;
	const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
		? `${value.replace(' ', 'T')}Z`
		: value;
	const date = new Date(normalized);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
export function buildSitemapXml(entries: SitemapEntry[]) {
	const urls = entries
		.map((entry) => {
			const lastmod = normalizeLastmod(entry.lastmod);
			return `  <url>\n    <loc>${escapeXml(entry.url)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`;
		})
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
