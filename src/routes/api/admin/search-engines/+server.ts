import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { validateSearchEngineInput } from '$lib/server/admin-validation';
import { mutationApiError, readJsonObject, validationApiError } from '$lib/server/admin-mutations';
import { createSearchEngine } from '$lib/server/services/admin-write';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request }) => {
	try {
		const validation = validateSearchEngineInput(await readJsonObject(request));
		if (!validation.valid) return validationApiError(validation);
		return json(
			{ id: await createSearchEngine(requireDatabase(platform), validation.data) },
			{ status: 201 }
		);
	} catch (error) {
		return mutationApiError(error);
	}
};
