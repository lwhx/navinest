import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { validateTagInput } from '$lib/server/admin-validation';
import {
	mutationApiError,
	parsePositiveId,
	readJsonObject,
	validationApiError
} from '$lib/server/admin-mutations';
import { AdminWriteError, deleteTag, updateTag } from '$lib/server/services/admin-write';
import type { RequestHandler } from './$types';

function idFrom(params: { id: string }): number {
	const id = parsePositiveId(params.id);
	if (!id) throw new AdminWriteError('标签 ID 无效。');
	return id;
}

export const PATCH: RequestHandler = async ({ platform, request, params }) => {
	try {
		const validation = validateTagInput(await readJsonObject(request));
		if (!validation.valid) return validationApiError(validation);
		await updateTag(requireDatabase(platform), idFrom(params), validation.data);
		return json({ success: true });
	} catch (error) {
		return mutationApiError(error);
	}
};

export const DELETE: RequestHandler = async ({ platform, params }) => {
	try {
		await deleteTag(requireDatabase(platform), idFrom(params));
		return new Response(null, { status: 204 });
	} catch (error) {
		return mutationApiError(error);
	}
};
