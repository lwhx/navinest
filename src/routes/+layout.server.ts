import { getDatabase } from '$lib/server/db';
import { loadSiteSettings } from '$lib/server/services/site-settings';
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = async ({ locals, platform }) => ({
	user: locals.user,
	site: await loadSiteSettings(getDatabase(platform))
});
