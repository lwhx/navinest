import type { Database, DatabaseValue } from '$lib/server/db';
import type { Category, ContentType } from '$lib/types/content';

type CategoryRow = {
	id: number;
	type: ContentType;
	parent_id: number | null;
	name: string;
	slug: string;
	icon: string | null;
	description: string | null;
	sort_order: number;
	is_visible: number;
	created_at: string;
	updated_at: string;
};

export type CategoryQuery = {
	type?: ContentType;
	visibleOnly?: boolean;
};

export async function listCategories(
	database: Database,
	query: CategoryQuery = {}
): Promise<Category[]> {
	const conditions: string[] = [];
	const values: DatabaseValue[] = [];

	if (query.type) {
		conditions.push('type = ?');
		values.push(query.type);
	}

	if (query.visibleOnly !== false) conditions.push('is_visible = 1');

	const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
	const statement = database
		.prepare(
			`SELECT id, type, parent_id, name, slug, icon, description, sort_order, is_visible,
				created_at, updated_at
			 FROM categories
			 ${where}
			 ORDER BY sort_order ASC, name ASC`
		)
		.bind(...values);
	const { results } = await statement.all<CategoryRow>();

	return results.map((row) => ({
		id: row.id,
		type: row.type,
		parentId: row.parent_id,
		name: row.name,
		slug: row.slug,
		icon: row.icon,
		description: row.description,
		sortOrder: row.sort_order,
		isVisible: row.is_visible === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	}));
}
