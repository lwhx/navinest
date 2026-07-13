import type { Database, DatabaseValue } from '$lib/server/db';
import type { ContentType, Tag } from '$lib/types/content';

type TagRow = {
	id: number;
	type: ContentType;
	name: string;
	slug: string;
	description: string | null;
	created_at: string;
	updated_at: string;
};

export async function listTags(database: Database, type?: ContentType): Promise<Tag[]> {
	const values: DatabaseValue[] = [];
	const where = type ? 'WHERE type = ?' : '';
	if (type) values.push(type);

	const statement = database
		.prepare(
			`SELECT id, type, name, slug, description, created_at, updated_at
			 FROM tags
			 ${where}
			 ORDER BY name ASC`
		)
		.bind(...values);
	const { results } = await statement.all<TagRow>();

	return results.map((row) => ({
		id: row.id,
		type: row.type,
		name: row.name,
		slug: row.slug,
		description: row.description,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	}));
}
