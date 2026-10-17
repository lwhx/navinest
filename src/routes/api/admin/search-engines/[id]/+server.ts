import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { validateSearchEngineInput } from '$lib/server/admin-validation';
import {
	mutationApiError,
	parsePositiveId,
	readJsonObject,
	validationApiError
} from '$lib/server/admin-mutations';
import {
	AdminWriteError,
	deleteSearchEngine,
	updateSearchEngine
} from '$lib/server/services/admin-write';
import type { RequestHandler } from './$types';

function idFrom(value: string) {
	const id = parsePositiveId(value);
	if (!id) throw new AdminWriteError('搜索源 ID 无效。');
	return id;
}
export const PATCH: RequestHandler = async ({ platform, request, params, url }) => {
	if (request.headers.get('origin') !== url.origin)
		return json({ error: '请求来源无效。' }, { status: 403 });
	try {
		const validation = validateSearchEngineInput(await readJsonObject(request));
		if (!validation.valid) return validationApiError(validation);
		await updateSearchEngine(requireDatabase(platform), idFrom(params.id), validation.data);
		return json({ success: true });
	} catch (error) {
		return mutationApiError(error);
	}
};
export const DELETE: RequestHandler = async ({ platform, params, request, url }) => {
	if (request.headers.get('origin') !== url.origin)
		return json({ error: '请求来源无效。' }, { status: 403 });
	if (request.headers.get('x-search-source-confirmed') !== 'yes')
		return json({ error: '请确认删除搜索源。' }, { status: 428 });
	try {
		await deleteSearchEngine(requireDatabase(platform), idFrom(params.id));
		return new Response(null, { status: 204 });
	} catch (error) {
		return mutationApiError(error);
	}
};
