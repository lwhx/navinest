import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { mutationApiError, readJsonObject, validationApiError } from '$lib/server/admin-mutations';
import {
	createAdminUser,
	listAdminUsers,
	validateAdminUserInput
} from '$lib/server/services/admin-users';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	try {
		return json({ data: await listAdminUsers(requireDatabase(platform)) });
	} catch (error) {
		return mutationApiError(error);
	}
};

export const POST: RequestHandler = async ({ platform, request }) => {
	try {
		const validation = validateAdminUserInput(await readJsonObject(request), {
			requirePassword: true
		});
		if (!validation.valid) return validationApiError(validation);
		const id = await createAdminUser(requireDatabase(platform), validation.data);
		return json({ id }, { status: 201 });
	} catch (error) {
		return mutationApiError(error);
	}
};
