import { redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { invalidAction, mutationActionError } from '$lib/server/admin-mutations';
import {
	loadSiteSettings,
	saveSiteSettings,
	validateSiteSettingsInput
} from '$lib/server/services/site-settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	const database = getDatabase(platform);
	return {
		settings: await loadSiteSettings(database),
		source: database ? ('database' as const) : ('fallback' as const)
	};
};

export const actions: Actions = {
	save: async ({ platform, request }) => {
		const formData = await request.formData();
		const validation = validateSiteSettingsInput(Object.fromEntries(formData));
		if (!validation.valid) return invalidAction(validation, formData);
		try {
			await saveSiteSettings(requireDatabase(platform), validation.data);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/settings?saved=1');
	}
};
