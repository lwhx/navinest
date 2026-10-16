import type { Database } from '$lib/server/db';
import { AdminFileError, deleteAdminFile } from './admin-files';

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
	await getOwnedFile(database, userId, id);
	try {
		await deleteAdminFile(database, bucket, id, userId);
	} catch (error) {
		if (error instanceof AdminFileError)
			throw new UserFileError(error.message, error.status === 404 ? 404 : 409);
		throw error;
	}
}
