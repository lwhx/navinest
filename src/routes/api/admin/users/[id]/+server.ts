import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import {
	mutationApiError,
	parsePositiveId,
	readJsonObject,
	validationApiError
} from '$lib/server/admin-mutations';
import { AdminWriteError } from '$lib/server/services/admin-write';
import { updateAdminUser, validateAdminUserInput } from '$lib/server/services/admin-users';
import type { RequestHandler } from './$types';

function idFrom(params: { id: string }): number {
	const id = parsePositiveId(params.id);
	if (!id) throw new AdminWriteError('用户 ID 无效。');
	return id;
}

export const PATCH: RequestHandler = async ({ platform, request, params }) => {
	try {
		const body = await readJsonObject(request);
		const validation = validateAdminUserInput(
			{ ...body, password: '' },
			{
				requirePassword: false
			}
		);
		if (!validation.valid) return validationApiError(validation);
		await updateAdminUser(requireDatabase(platform), idFrom(params), validation.data);
		return json({ success: true });
	} catch (error) {
		return mutationApiError(error);
	}
};
