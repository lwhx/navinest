import type { Database } from '$lib/server/db';

export type OwnedFile = {
	id: number;
	userId: number;
	objectKey: string;
	mimeType: string | null;
	size: number | null;
};
type FileRow = {
	id: number;
	user_id: number;
	object_key: string;
	mime_type: string | null;
	size: number | null;
};
export class UserFileError extends Error {
	constructor(
		message: string,
		public readonly status: 404 | 409 = 404
	) {
		super(message);
		this.name = 'UserFileError';
	}
}
export interface DeleteBucket {
	delete(key: string): Promise<unknown>;
}
export async function getOwnedFile(
	database: Database,
	userId: number,
	id: number
): Promise<OwnedFile> {
	const row = (
		await database
			.prepare(
				"SELECT id,user_id,object_key,mime_type,size FROM files WHERE id=? AND user_id=? AND bucket='FILES' LIMIT 1"
			)
			.bind(id, userId)
			.all<FileRow>()
	).results[0];
	if (!row) throw new UserFileError('文件不存在。');
	return {
		id: row.id,
		userId: row.user_id,
		objectKey: row.object_key,
		mimeType: row.mime_type,
		size: row.size
	};
}
export async function deleteOwnedFile(
	database: Database,
	bucket: DeleteBucket,
	userId: number,
	id: number
) {
	const file = await getOwnedFile(database, userId, id);
	const reference = (
		await database
			.prepare(
				`SELECT 1 AS id WHERE
					EXISTS(SELECT 1 FROM users WHERE id=? AND (avatar_file_id=? OR cover_file_id=?))
					OR EXISTS(SELECT 1 FROM items WHERE icon_file_id=? OR cover_file_id=?)
					OR EXISTS(SELECT 1 FROM submissions WHERE status='pending' AND CAST(json_extract(payload_json,'$.iconFileId') AS INTEGER)=?)
				 LIMIT 1`
			)
			.bind(userId, id, id, id, id, id)
			.all<{ id: number }>()
	).results[0];
	if (reference) throw new UserFileError('文件正在被用户资料、内容或待审核投稿引用。', 409);
	await bucket.delete(file.objectKey);
	await database.prepare('DELETE FROM files WHERE id=? AND user_id=?').bind(id, userId).all();
}
