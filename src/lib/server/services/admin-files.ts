import type { Database } from '$lib/server/db';

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
	['image/jpeg', 'jpg'],
	['image/png', 'png'],
	['image/webp', 'webp'],
	['image/gif', 'gif'],
	['image/svg+xml', 'svg'],
	['image/x-icon', 'ico'],
	['image/vnd.microsoft.icon', 'ico']
]);

export interface FileBucket {
	put(
		key: string,
		value: ArrayBuffer,
		options?: { httpMetadata?: { contentType?: string } }
	): Promise<unknown>;
	delete(key: string): Promise<unknown>;
}

export type AdminFileRecord = {
	id: number;
	userId: number | null;
	bucket: string;
	objectKey: string;
	publicUrl: string | null;
	mimeType: string | null;
	size: number | null;
	width: number | null;
	height: number | null;
	createdAt: string;
	references: Array<{ itemId: number; title: string; usage: 'icon' | 'cover' }>;
};

type FileRow = {
	id: number;
	user_id: number | null;
	bucket: string;
	object_key: string;
	public_url: string | null;
	mime_type: string | null;
	size: number | null;
	width: number | null;
	height: number | null;
	created_at: string;
};

export class AdminFileError extends Error {
	constructor(
		message: string,
		public readonly status: 400 | 404 | 409 | 503 = 400
	) {
		super(message);
		this.name = 'AdminFileError';
	}
}

export function validateAdminUpload(file: File) {
	const extension = MIME_EXTENSIONS.get(file.type.toLowerCase());
	if (!extension)
		return { valid: false as const, message: '仅支持 JPEG、PNG、WebP、GIF、SVG 和 ICO 图片。' };
	if (file.size === 0) return { valid: false as const, message: '上传文件不能为空。' };
	if (file.size > MAX_UPLOAD_SIZE)
		return { valid: false as const, message: '文件不能超过 5 MiB。' };
	return { valid: true as const, extension };
}

export function createFileObjectKey(
	extension: string,
	now = new Date(),
	id: string = crypto.randomUUID()
) {
	const year = now.getUTCFullYear();
	const month = String(now.getUTCMonth() + 1).padStart(2, '0');
	return `uploads/${year}/${month}/${id}.${extension}`;
}

function toRecord(row: FileRow): AdminFileRecord {
	return {
		id: row.id,
		userId: row.user_id,
		bucket: row.bucket,
		objectKey: row.object_key,
		publicUrl: row.public_url,
		mimeType: row.mime_type,
		size: row.size,
		width: row.width,
		height: row.height,
		createdAt: row.created_at,
		references: []
	};
}

export async function listAdminFiles(database: Database): Promise<AdminFileRecord[]> {
	const { results } = await database
		.prepare(
			'SELECT id, user_id, bucket, object_key, public_url, mime_type, size, width, height, created_at FROM files ORDER BY created_at DESC, id DESC LIMIT 200'
		)
		.all<FileRow>();
	const files = results.map(toRecord);
	if (files.length === 0) return files;
	const { results: references } = await database
		.prepare(
			`SELECT id AS item_id, title, icon_file_id AS file_id, 'icon' AS usage FROM items WHERE icon_file_id IS NOT NULL
			 UNION ALL
			 SELECT id AS item_id, title, cover_file_id AS file_id, 'cover' AS usage FROM items WHERE cover_file_id IS NOT NULL
			 ORDER BY item_id, usage DESC`
		)
		.all<{ item_id: number; title: string; file_id: number; usage: 'icon' | 'cover' }>();
	const byFile = new Map<number, AdminFileRecord['references']>();
	for (const reference of references) {
		const group = byFile.get(reference.file_id) ?? [];
		group.push({ itemId: reference.item_id, title: reference.title, usage: reference.usage });
		byFile.set(reference.file_id, group);
	}
	for (const file of files) file.references = byFile.get(file.id) ?? [];
	return files;
}

export async function getAdminFile(
	database: Database,
	id: number
): Promise<AdminFileRecord | null> {
	const { results } = await database
		.prepare(
			'SELECT id, user_id, bucket, object_key, public_url, mime_type, size, width, height, created_at FROM files WHERE id = ? LIMIT 1'
		)
		.bind(id)
		.all<FileRow>();
	return results[0] ? toRecord(results[0]) : null;
}

export async function storeAdminFile(options: {
	database: Database;
	bucket: FileBucket;
	file: File;
	userId: number | null;
	now?: Date;
	id?: string;
}): Promise<AdminFileRecord> {
	const validation = validateAdminUpload(options.file);
	if (!validation.valid) throw new AdminFileError(validation.message);
	const objectKey = createFileObjectKey(validation.extension, options.now, options.id);
	const contents = await options.file.arrayBuffer();
	await options.bucket.put(objectKey, contents, {
		httpMetadata: { contentType: options.file.type }
	});

	try {
		const { results } = await options.database
			.prepare(
				`INSERT INTO files (user_id, bucket, object_key, public_url, mime_type, size) VALUES (?, 'FILES', ?, NULL, ?, ?) RETURNING id, user_id, bucket, object_key, public_url, mime_type, size, width, height, created_at`
			)
			.bind(options.userId, objectKey, options.file.type, options.file.size)
			.all<FileRow>();
		const row = results[0];
		if (!row) throw new AdminFileError('文件索引写入失败。');
		return toRecord(row);
	} catch (error) {
		await options.bucket.delete(objectKey);
		throw error;
	}
}

export async function deleteAdminFile(database: Database, bucket: FileBucket, id: number) {
	const file = await getAdminFile(database, id);
	if (!file) throw new AdminFileError('文件不存在。', 404);
	const { results } = await database
		.prepare('SELECT id FROM items WHERE cover_file_id = ? OR icon_file_id = ? LIMIT 1')
		.bind(id, id)
		.all<{ id: number }>();
	if (results[0]) throw new AdminFileError('文件正在被内容引用，不能删除。', 409);

	await bucket.delete(file.objectKey);
	await database.prepare('DELETE FROM files WHERE id = ?').bind(id).all();
}
