import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { mutationApiError, readJsonObject } from '$lib/server/admin-mutations';
import { bulkUpdateAdminContent } from '$lib/server/services/admin-content';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ platform, request }) => {
	try {
		return json(
			await bulkUpdateAdminContent(requireDatabase(platform), await readJsonObject(request))
		);
	} catch (error) {
		return mutationApiError(error);
	}
};
