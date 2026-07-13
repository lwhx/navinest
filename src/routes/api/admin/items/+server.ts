import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { validateItemInput } from '$lib/server/admin-validation';
import { mutationApiError, readJsonObject, validationApiError } from '$lib/server/admin-mutations';
import { createItem } from '$lib/server/services/admin-write';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request, locals }) => {
	try {
		const validation = validateItemInput(await readJsonObject(request));
		if (!validation.valid) return validationApiError(validation);
		const id = await createItem(
			requireDatabase(platform),
			validation.data,
			locals.admin?.id ?? null
		);
		return json({ id }, { status: 201 });
	} catch (error) {
		return mutationApiError(error);
	}
};
