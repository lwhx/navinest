import { json } from '@sveltejs/kit';
import { BookmarkImportError } from './services/bookmark-import-workspace';
import { CustomNavigationError } from './services/custom-navigation';
export function bookmarkOrigin(request: Request) {
	if (request.headers.get('origin') !== new URL(request.url).origin)
		throw new BookmarkImportError('请求来源无效。', 403);
}
export async function readBookmarkRequest(request: Request) {
	bookmarkOrigin(request);
	if (
		request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
	)
		throw new BookmarkImportError('请使用 JSON 提交导入信息。', 415);
	const max = 4 * 1024 * 1024;
	if (Number(request.headers.get('content-length')) > max)
		throw new BookmarkImportError('导入请求过大，请缩小文件。', 413);
	if (!request.body) throw new BookmarkImportError('导入内容为空。');
	const reader = request.body.getReader(),
		chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > max) {
				await reader.cancel();
				throw new BookmarkImportError('导入请求过大，请缩小文件。', 413);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} catch {
		throw new BookmarkImportError('导入请求格式无效。');
	}
}
export function bookmarkError(error: unknown, uncertain = false) {
	if (error instanceof BookmarkImportError)
		return json({ error: error.message, uncertain: error.uncertain }, { status: error.status });
	if (error instanceof CustomNavigationError)
		return json({ error: error.message, uncertain: false }, { status: error.status });
	return json(
		{
			error: uncertain ? '导入结果尚未确认，请核对本批次。' : '暂时无法读取导入信息，请稍后重试。',
			uncertain
		},
		{ status: 503 }
	);
}
