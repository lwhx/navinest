import type { Database } from '$lib/server/db';

export const SHARE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,29}$/;
export const RESERVED_SHARE_SLUGS = new Set([
	'admin',
	'api',
	'assets',
	'books',
	'bulletins',
	'categories',
	'contribute',
	'go',
	'hotnews',
	'login',
	'logout',
	'posts',
	'rankings',
	'register',
	'robots',
	'search',
	'sites',
	'sitemap',
	'tags',
	'u',
	'user'
]);

export class SharePageError extends Error {
	constructor(
		message: string,
		public readonly field?: string,
		public readonly status: 400 | 404 | 409 = 400
	) {
		super(message);
		this.name = 'SharePageError';
	}
}

export type ShareSettings = { slug: string; enabled: boolean };

export type PublicShareLink = {
	id: number;
	title: string;
	url: string;
	summary: string | null;
};

export type PublicShare = {
	slug: string;
	owner: { username: string; displayName: string };
	groups: Array<{ id: number | null; name: string | null; links: PublicShareLink[] }>;
	total: number;
};

export function validateShareSlug(input: unknown): string {
	const slug = typeof input === 'string' ? input.trim().toLowerCase() : '';
	if (!slug) throw new SharePageError('请填写分享地址。', 'slug');
	if (!SHARE_SLUG_PATTERN.test(slug))
		throw new SharePageError(
			'分享地址需为 3–30 位小写字母、数字或连字符，并以字母或数字开头。',
			'slug'
		);
	if (RESERVED_SHARE_SLUGS.has(slug))
		throw new SharePageError('该分享地址被系统保留，请换一个。', 'slug');
	return slug;
}

export async function getShareSettings(database: Database, userId: number): Promise<ShareSettings> {
	const row = (
		await database
			.prepare('SELECT share_slug,share_enabled FROM users WHERE id=? LIMIT 1')
			.bind(userId)
			.all<{ share_slug: string | null; share_enabled: number }>()
	).results[0];
	return { slug: row?.share_slug ?? '', enabled: Boolean(row?.share_enabled) };
}

export async function saveShareSettings(
	database: Database,
	userId: number,
	input: { slug?: unknown; enabled?: unknown }
): Promise<ShareSettings> {
	const current = await getShareSettings(database, userId);
	const slug = validateShareSlug(
		typeof input.slug === 'string' && input.slug.trim() ? input.slug : current.slug
	);
	const enabled =
		typeof input.enabled === 'boolean'
			? input.enabled
			: input.enabled === 'true' || input.enabled === 'on' || input.enabled === 1;
	const taken = (
		await database
			.prepare('SELECT id FROM users WHERE share_slug=? AND id<>? LIMIT 1')
			.bind(slug, userId)
			.all<{ id: number }>()
	).results[0];
	if (taken) throw new SharePageError('该分享地址已被占用，请换一个。', 'slug', 409);
	await database
		.prepare(
			'UPDATE users SET share_slug=?,share_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
		)
		.bind(slug, enabled ? 1 : 0, userId)
		.all();
	return { slug, enabled };
}

/** Returns null unless the page exists, is switched on and the owner is still active. */
export async function loadPublicShare(
	database: Database,
	slug: string
): Promise<PublicShare | null> {
	const normalized = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
	if (!normalized) return null;
	const owner = (
		await database
			.prepare(
				"SELECT id,username,display_name FROM users WHERE share_slug=? AND share_enabled=1 AND status='active' LIMIT 1"
			)
			.bind(normalized)
			.all<{ id: number; username: string; display_name: string }>()
	).results[0];
	if (!owner) return null;
	const [categories, links] = await Promise.all([
		database
			.prepare(
				'SELECT id,name FROM custom_categories WHERE user_id=? ORDER BY sort_order ASC,id ASC'
			)
			.bind(owner.id)
			.all<{ id: number; name: string }>(),
		database
			.prepare(
				"SELECT id,category_id,title,url,summary FROM custom_links WHERE user_id=? AND status='active' ORDER BY sort_order ASC,id ASC"
			)
			.bind(owner.id)
			.all<{
				id: number;
				category_id: number | null;
				title: string;
				url: string;
				summary: string | null;
			}>()
	]);
	const groups: PublicShare['groups'] = categories.results
		.map((category) => ({
			id: category.id,
			name: category.name,
			links: links.results
				.filter((link) => link.category_id === category.id)
				.map((link) => ({
					id: link.id,
					title: link.title,
					url: link.url,
					summary: link.summary
				}))
		}))
		.filter((group) => group.links.length > 0);
	const uncategorized = links.results
		.filter((link) => link.category_id === null)
		.map((link) => ({ id: link.id, title: link.title, url: link.url, summary: link.summary }));
	if (uncategorized.length) groups.push({ id: null, name: null, links: uncategorized });
	return {
		slug: normalized,
		owner: { username: owner.username, displayName: owner.display_name },
		groups,
		total: links.results.length
	};
}
