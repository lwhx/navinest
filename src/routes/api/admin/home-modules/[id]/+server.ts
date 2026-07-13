import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { validateHomeModuleInput } from '$lib/server/admin-validation';
import {
	mutationApiError,
	parsePositiveId,
	readJsonObject,
	validationApiError
} from '$lib/server/admin-mutations';
import {
	AdminWriteError,
	deleteHomeModule,
	updateHomeModule
} from '$lib/server/services/admin-write';
import type { RequestHandler } from './$types';

function idFrom(value: string) {
	const id = parsePositiveId(value);
	if (!id) throw new AdminWriteError('首页模块 ID 无效。');
	return id;
}
export const PATCH: RequestHandler = async ({ platform, request, params }) => {
	try {
		const validation = validateHomeModuleInput(await readJsonObject(request));
		if (!validation.valid) return validationApiError(validation);
		await updateHomeModule(requireDatabase(platform), idFrom(params.id), validation.data);
		return json({ success: true });
	} catch (error) {
		return mutationApiError(error);
	}
};
export const DELETE: RequestHandler = async ({ platform, params }) => {
	try {
		await deleteHomeModule(requireDatabase(platform), idFrom(params.id));
		return new Response(null, { status: 204 });
	} catch (error) {
		return mutationApiError(error);
	}
};
