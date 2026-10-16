import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { mutationApiError } from '$lib/server/admin-mutations';
import { withdrawMessageBatch } from '$lib/server/services/admin-messages';
import type { RequestHandler } from './$types';
export const DELETE: RequestHandler = async ({ platform, params, locals, request, url }) => {
	if (!locals.admin) return json({ error: '需要管理员身份。' }, { status: 403 });
	if (request.headers.get('origin') !== url.origin)
		return json({ error: '请求来源无效。' }, { status: 403 });
	if (request.headers.get('x-message-confirmed') !== 'yes')
		return json({ error: '请先确认撤回。' }, { status: 428 });
	try {
		const removed = await withdrawMessageBatch(requireDatabase(platform), params.batchId);
		return json({ removed });
	} catch (error) {
		return mutationApiError(error);
	}
};
