import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import {
	bookmarkImportReceipt,
	cancelBookmarkImport,
	commitBookmarkImport,
	BookmarkImportError
} from '$lib/server/services/bookmark-import-workspace';
import { readBookmarkRequest, bookmarkError } from '$lib/server/bookmark-import-request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user)
		return json({ error: '请先登录后再操作导入。', uncertain: false }, { status: 401 });
	try {
		const body = await readBookmarkRequest(request);
		if (!body || typeof body !== 'object' || Array.isArray(body))
			throw new BookmarkImportError('导入内容格式无效。');
		const data = body as Record<string, unknown>,
			db = requireDatabase(platform);
		if (data.action === 'cancel') {
			if (data.confirmed !== true) throw new BookmarkImportError('请确认取消尚未开始的批次。', 428);
			return json({
				receipt: await cancelBookmarkImport(db, locals.user.id, data.runId, data.digest)
			});
		}
		return json({ receipt: await commitBookmarkImport(db, locals.user.id, body) });
	} catch (error) {
		return bookmarkError(error, true);
	}
};
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	try {
		return json(
			{
				receipt: await bookmarkImportReceipt(
					requireDatabase(platform),
					locals.user.id,
					url.searchParams.get('runId')
				)
			},
			{ headers: { 'cache-control': 'private, no-store' } }
		);
	} catch (error) {
		return bookmarkError(error);
	}
};
