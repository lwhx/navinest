import { getDatabase } from '$lib/server/db';
import { searchContent, searchFallback } from '$lib/server/services/content-pages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	const database = getDatabase(platform);

	if (!database) return { query, ...searchFallback(query) };

	try {
		return { query, ...(await searchContent(database, query)) };
	} catch (error) {
		console.error('Failed to search D1; using fallback data.', error);
		return { query, ...searchFallback(query) };
	}
};
