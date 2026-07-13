import { getDatabase } from '$lib/server/db';
import { cacheControlFor } from '$lib/server/cache-policy';
import { fallbackHomeData, loadHomeData } from '$lib/server/services/home';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, setHeaders }) => {
	setHeaders({ 'cache-control': cacheControlFor('identity-page') });
	const database = getDatabase(platform);

	if (!database) return fallbackHomeData();

	try {
		return await loadHomeData(database);
	} catch (error) {
		console.error('Failed to load homepage data from D1; using fallback data.', error);
		return fallbackHomeData();
	}
};
