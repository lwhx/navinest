import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { mutationApiError, parsePositiveId, readJsonObject } from '$lib/server/admin-mutations';
import { AdminWriteError } from '$lib/server/services/admin-write';
import { resetAdminUserPassword } from '$lib/server/services/admin-users';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request, params }) => {
	try {
		const id = parsePositiveId(params.id);
		if (!id) throw new AdminWriteError('用户 ID 无效。');
		const body = await readJsonObject(request);
		const password = typeof body.password === 'string' ? body.password : '';
		await resetAdminUserPassword(requireDatabase(platform), id, password);
		return json({ success: true });
	} catch (error) {
		return mutationApiError(error);
	}
};
