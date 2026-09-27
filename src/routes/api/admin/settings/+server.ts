import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { mutationApiError, readJsonObject, validationApiError } from '$lib/server/admin-mutations';
import {
	readSiteSettings,
	saveSiteSettings,
	validateSiteSettingsInput
} from '$lib/server/services/site-settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	try {
		return json({ data: await readSiteSettings(requireDatabase(platform)) });
	} catch (error) {
		return mutationApiError(error);
	}
};

export const PUT: RequestHandler = async ({ platform, request }) => {
	try {
		const validation = validateSiteSettingsInput(await readJsonObject(request));
		if (!validation.valid) return validationApiError(validation);
		await saveSiteSettings(requireDatabase(platform), validation.data);
		return json({ data: validation.data });
	} catch (error) {
		return mutationApiError(error);
	}
};
