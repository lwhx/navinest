import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { validateCategoryInput } from '$lib/server/admin-validation';
import { mutationApiError, readJsonObject, validationApiError } from '$lib/server/admin-mutations';
import { createCategory } from '$lib/server/services/admin-write';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request }) => {
	try {
		const validation = validateCategoryInput(await readJsonObject(request));
		if (!validation.valid) return validationApiError(validation);
		const id = await createCategory(requireDatabase(platform), validation.data);
		return json({ id }, { status: 201 });
	} catch (error) {
		return mutationApiError(error);
	}
};
