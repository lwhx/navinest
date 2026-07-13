import type { Database, DatabaseValue } from '$lib/server/db';
import type { ContentType, Item } from '$lib/types/content';

const META_SEPARATOR = String.fromCharCode(30);
const TAG_SEPARATOR = String.fromCharCode(31);

type ItemRow = {
	id: number;
	type: ContentType;
	category_id: number | null;
	author_id: number | null;
	title: string;
	slug: string;
	summary: string | null;
	content: string | null;
	cover_file_id: number | null;
	icon_file_id: number | null;
	status: string;
	visibility: string;
	sort_order: number;
	is_featured: number;
	published_at: string | null;
	created_at: string;
	updated_at: string;
	category_name: string | null;
	category_slug: string | null;
	tag_entries: string | null;
	meta_entries: string | null;
};

export type ItemQuery = {
	type?: ContentType;
	slug?: string;
	categorySlug?: string;
	tagSlug?: string;
	search?: string;
	status?: string | null;
	visibility?: string | null;
	limit?: number;
	offset?: number;
};

function clampInteger(value: number | undefined, fallback: number, maximum: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.trunc(value ?? fallback), 0), maximum);
}

function parseMeta(entries: string | null): Record<string, string> {
	if (!entries) return {};

	return Object.fromEntries(
		entries.split(TAG_SEPARATOR).flatMap((entry) => {
			const separatorIndex = entry.indexOf(META_SEPARATOR);
			if (separatorIndex < 0) return [];
			return [[entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)]];
		})
	);
}

function parseTags(entries: string | null): Array<{ name: string; slug: string }> {
	if (!entries) return [];

	return entries.split(TAG_SEPARATOR).flatMap((entry) => {
		const separatorIndex = entry.indexOf(META_SEPARATOR);
		if (separatorIndex < 0) return [];
		return [{ slug: entry.slice(0, separatorIndex), name: entry.slice(separatorIndex + 1) }];
	});
}

export async function listItems(database: Database, query: ItemQuery = {}): Promise<Item[]> {
	const conditions: string[] = [];
	const values: DatabaseValue[] = [];

	if (query.visibility !== null) {
		conditions.push('i.visibility = ?');
		values.push(query.visibility ?? 'public');
	}

	if (query.status !== null) {
		conditions.push('i.status = ?');
		values.push(query.status ?? 'published');
	}

	if (query.type) {
		conditions.push('i.type = ?');
		values.push(query.type);
	}

	if (query.slug) {
		conditions.push('i.slug = ?');
		values.push(query.slug);
	}

	if (query.categorySlug) {
		conditions.push('c.slug = ?');
		values.push(query.categorySlug);
	}

	if (query.tagSlug) {
		conditions.push(
			'EXISTS (SELECT 1 FROM item_tags filter_it JOIN tags filter_tag ON filter_tag.id = filter_it.tag_id WHERE filter_it.item_id = i.id AND filter_tag.slug = ?)'
		);
		values.push(query.tagSlug);
	}

	if (query.search?.trim()) {
		conditions.push("(i.title LIKE ? ESCAPE '\\' OR i.summary LIKE ? ESCAPE '\\')");
		const escaped = query.search.trim().replace(/[\\%_]/g, '\\$&');
		values.push(`%${escaped}%`, `%${escaped}%`);
	}

	const limit = clampInteger(query.limit, 50, 100);
	const offset = clampInteger(query.offset, 0, 100_000);
	values.push(limit, offset);
	const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

	const statement = database
		.prepare(
			`SELECT i.id, i.type, i.category_id, i.author_id, i.title, i.slug, i.summary,
				i.content, i.cover_file_id, i.icon_file_id, i.status, i.visibility, i.sort_order,
				i.is_featured, i.published_at, i.created_at, i.updated_at,
				c.name AS category_name, c.slug AS category_slug,
				(SELECT GROUP_CONCAT(t.slug || char(30) || t.name, char(31))
				 FROM item_tags it JOIN tags t ON t.id = it.tag_id
				 WHERE it.item_id = i.id) AS tag_entries,
				(SELECT GROUP_CONCAT(im.meta_key || char(30) || COALESCE(im.meta_value, ''), char(31))
				 FROM item_meta im WHERE im.item_id = i.id) AS meta_entries
			 FROM items i
			 LEFT JOIN categories c ON c.id = i.category_id
			 ${where}
			 ORDER BY i.sort_order ASC, i.is_featured DESC, i.title ASC
			 LIMIT ? OFFSET ?`
		)
		.bind(...values);
	const { results } = await statement.all<ItemRow>();

	return results.map((row) => ({
		id: row.id,
		type: row.type,
		categoryId: row.category_id,
		authorId: row.author_id,
		title: row.title,
		slug: row.slug,
		summary: row.summary,
		content: row.content,
		coverFileId: row.cover_file_id,
		iconFileId: row.icon_file_id,
		status: row.status,
		visibility: row.visibility,
		sortOrder: row.sort_order,
		isFeatured: row.is_featured === 1,
		publishedAt: row.published_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		category:
			row.category_id && row.category_name && row.category_slug
				? { id: row.category_id, name: row.category_name, slug: row.category_slug }
				: null,
		tags: parseTags(row.tag_entries),
		meta: parseMeta(row.meta_entries)
	}));
}

export async function getItemBySlug(
	database: Database,
	type: ContentType,
	slug: string
): Promise<Item | null> {
	const [item] = await listItems(database, { type, slug, limit: 1 });
	return item ?? null;
}
