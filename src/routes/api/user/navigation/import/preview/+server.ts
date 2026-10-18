import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { prepareBookmarkImport } from '$lib/server/services/bookmark-import-workspace';
import { readBookmarkRequest, bookmarkError } from '$lib/server/bookmark-import-request';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	try {
		const { preview } = await prepareBookmarkImport(
			requireDatabase(platform),
			locals.user.id,
			await readBookmarkRequest(request)
		);
		return json({ preview }, { headers: { 'cache-control': 'private, no-store' } });
	} catch (error) {
		return bookmarkError(error);
	}
};
