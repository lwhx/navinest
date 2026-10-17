import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { HotNewsError, refreshHotSource, hotFailure } from '$lib/server/services/hotnews';
import { reportHotAlerts } from '$lib/server/services/hot-health-alerts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ platform, params, locals, request, url }) => {
	if (!locals.admin) return json({ error: '需要管理员身份。' }, { status: 403 });
	if (request.headers.get('origin') !== url.origin)
		return json({ error: '请求来源无效。' }, { status: 403 });
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0)
		return json({ error: '热榜编号无效。' }, { status: 400 });
	const database = requireDatabase(platform),
		options = { alertWebhookUrl: platform?.env?.ALERT_WEBHOOK_URL };
	try {
		const result = await refreshHotSource(database, id),
			alert = await reportHotAlerts(database, `source:${id}:${crypto.randomUUID()}`, options);
		return json({ ...result, warning: alert.warning });
	} catch (error) {
		if (!(error instanceof HotNewsError) || ![404, 409].includes(error.status))
			await reportHotAlerts(database, `source:${id}:${crypto.randomUUID()}`, options);
		return json(hotFailure(error), { status: error instanceof HotNewsError ? error.status : 500 });
	}
};
