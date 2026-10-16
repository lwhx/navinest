import type { Database, DatabaseValue } from '$lib/server/db';
import { MEDIA_PAGE_SIZE, mediaFilters, type MediaFilters } from '$lib/media-library';
import { FILE_REFERENCES, fileReferenceCondition } from './file-references';

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
	references: FileReference[];
};

export type FileReference = {
	kind: 'item' | 'user' | 'submission';
	id: number;
	title: string;
	usage: 'icon' | 'cover' | 'avatar' | 'profileCover' | 'submission';
};
export type MediaPage = {
	files: AdminFileRecord[];
	filters: MediaFilters;
	total: number;
	pageCount: number;
	pageSize: number;
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

export async function loadMediaPage(
	database: Database,
	params = new URLSearchParams(),
	imagesOnly = false
): Promise<MediaPage> {
	const filters = mediaFilters(params),
		clauses = ["f.bucket='FILES'"],
		values: DatabaseValue[] = [];
	if (imagesOnly) clauses.push("f.mime_type LIKE 'image/%'");
	if (filters.q) {
		clauses.push(
			'(instr(lower(f.object_key),lower(?))>0 OR CAST(f.id AS TEXT)=? OR EXISTS(SELECT 1 FROM refs r WHERE r.file_id=f.id AND instr(lower(r.title),lower(?))>0))'
		);
		values.push(filters.q, filters.q.replace(/^#/, ''), filters.q);
	}
	const types: Record<string, string[]> = {
		png: ['image/png'],
		jpeg: ['image/jpeg'],
		webp: ['image/webp'],
		gif: ['image/gif'],
		svg: ['image/svg+xml'],
		ico: ['image/x-icon', 'image/vnd.microsoft.icon']
	};
	if (filters.kind !== 'all') {
		const kinds = filters.kind === 'other' ? Object.values(types).flat() : types[filters.kind];
		clauses.push(
			`COALESCE(f.mime_type,'') ${filters.kind === 'other' ? 'NOT IN' : 'IN'} (${kinds.map(() => '?').join(',')})`
		);
		values.push(...kinds);
	}
	if (filters.usage !== 'all')
		clauses.push(`${filters.usage === 'unused' ? 'NOT ' : ''}${fileReferenceCondition('f.id')}`);
	if (filters.from) {
		clauses.push('date(f.created_at)>=?');
		values.push(filters.from);
	}
	if (filters.to) {
		clauses.push('date(f.created_at)<=?');
		values.push(filters.to);
	}
	const prefix = `WITH refs AS (${FILE_REFERENCES})`,
		where = clauses.join(' AND ');
	const total =
		(
			await database
				.prepare(`${prefix} SELECT COUNT(*) AS n FROM files f WHERE ${where}`)
				.bind(...values)
				.all<{ n: number }>()
		).results[0]?.n ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / MEDIA_PAGE_SIZE));
	filters.page = Math.min(filters.page, pageCount);
	const order =
		filters.order === 'oldest'
			? 'f.created_at ASC,f.id ASC'
			: filters.order === 'size'
				? 'f.size DESC,f.id DESC'
				: 'f.created_at DESC,f.id DESC';
	const files = (
		await database
			.prepare(
				`${prefix} SELECT f.* FROM files f WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`
			)
			.bind(...values, MEDIA_PAGE_SIZE, (filters.page - 1) * MEDIA_PAGE_SIZE)
			.all<FileRow>()
	).results.map(toRecord);
	if (files.length) {
		const refs = (
			await database
				.prepare(
					`${prefix} SELECT * FROM refs WHERE file_id IN (${files.map(() => '?').join(',')}) ORDER BY kind,id,usage`
				)
				.bind(...files.map((f) => f.id))
				.all<FileReference & { file_id: number }>()
		).results;
		for (const file of files)
			file.references = refs
				.filter((r) => r.file_id === file.id)
				.map(({ kind, id, title, usage }) => ({ kind, id, title, usage }));
	}
	return { files, filters, total, pageCount, pageSize: MEDIA_PAGE_SIZE };
}
export async function listAdminFiles(database: Database) {
	return (await loadMediaPage(database)).files;
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

export async function deleteAdminFile(
	database: Database,
	bucket: Pick<FileBucket, 'delete'>,
	id: number,
	ownerId?: number
) {
	const file = await getAdminFile(database, id);
	if (!file || (ownerId !== undefined && file.userId !== ownerId))
		throw new AdminFileError('文件不存在。', 404);
	if (file.bucket !== 'FILES') throw new AdminFileError('该文件不属于可管理的图片存储。', 409);
	// The reference check and index removal are one D1 statement. A late reference wins over deletion.
	const removed = (
		await database
			.prepare(
				`DELETE FROM files WHERE id=? AND bucket='FILES' ${ownerId === undefined ? '' : 'AND user_id=?'} AND NOT ${fileReferenceCondition('files.id')} RETURNING id`
			)
			.bind(id, ...(ownerId === undefined ? [] : [ownerId]))
			.all<{ id: number }>()
	).results[0];
	if (!removed)
		throw new AdminFileError(
			'文件正在被内容、用户资料或待处理投稿引用，或状态已变化，请刷新核对。',
			409
		);
	try {
		await bucket.delete(file.objectKey);
	} catch (error) {
		// Retain a retryable index when storage deletion fails; never clear references to force deletion.
		await database
			.prepare(
				'INSERT INTO files(id,user_id,bucket,object_key,public_url,mime_type,size,width,height,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
			)
			.bind(
				file.id,
				file.userId,
				file.bucket,
				file.objectKey,
				file.publicUrl,
				file.mimeType,
				file.size,
				file.width,
				file.height,
				file.createdAt
			)
			.all();
		throw error;
	}
}
