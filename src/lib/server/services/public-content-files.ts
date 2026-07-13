import type { Database } from '$lib/server/db';
type Row = { object_key: string; mime_type: string | null };
export async function getPublicContentFile(database: Database, id: number) {
	const row = (
		await database
			.prepare(
				`SELECT f.object_key,f.mime_type FROM files f WHERE f.id=? AND EXISTS(SELECT 1 FROM items i WHERE (i.icon_file_id=f.id OR i.cover_file_id=f.id) AND i.status='published' AND i.visibility='public') LIMIT 1`
			)
			.bind(id)
			.all<Row>()
	).results[0];
	return row ? { objectKey: row.object_key, mimeType: row.mime_type } : null;
}
