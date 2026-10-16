import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { mutationApiError, readJsonObject, validationApiError } from '$lib/server/admin-mutations';
import {
	loadMessageBatches,
	listMessageRecipients,
	messageStats,
	previewAdminMessage,
	sendAdminMessage,
	validateAdminMessageInput,
	getMessageBatch
} from '$lib/server/services/admin-messages';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ platform, url, locals }) => {
	if (!locals.admin) return json({ error: '需要管理员身份。' }, { status: 403 });
	try {
		const db = requireDatabase(platform);
		if (url.searchParams.has('batch'))
			return json({
				batch: await getMessageBatch(db, (url.searchParams.get('batch') ?? '').slice(0, 80))
			});
		const [history, recipients, stats] = await Promise.all([
			loadMessageBatches(db, url.searchParams),
			listMessageRecipients(db, (url.searchParams.get('recipientQ') ?? '').slice(0, 100)),
			messageStats(db)
		]);
		return json({ ...history, ...recipients, stats });
	} catch (error) {
		return mutationApiError(error);
	}
};
export const POST: RequestHandler = async ({ platform, request, locals, url }) => {
	if (!locals.admin) return json({ error: '需要管理员身份。' }, { status: 403 });
	if (request.headers.get('origin') !== url.origin)
		return json({ error: '请求来源无效。' }, { status: 403 });
	try {
		const body = await readJsonObject(request),
			validation = validateAdminMessageInput(body);
		if (!validation.valid) return validationApiError(validation);
		const db = requireDatabase(platform);
		if (body.action === 'preview')
			return json({ preview: await previewAdminMessage(db, locals.admin.id, validation.data) });
		if (body.confirmed !== true)
			return json({ error: '请先确认接收范围和消息内容。' }, { status: 428 });
		return json(await sendAdminMessage(db, locals.admin.id, validation.data, body.proof), {
			status: 201
		});
	} catch (error) {
		if (error instanceof Error && !('status' in error))
			return json({ error: '发送结果待核对，请沿用同一批次核对或重试。' }, { status: 500 });
		return mutationApiError(error);
	}
};
