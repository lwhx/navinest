import { getDatabase } from '$lib/server/db';
import { searchContent, searchFallback } from '$lib/server/services/content-pages';
import type { PageServerLoad } from './$types';
import { parseSearchPage } from '$lib/search';

export const load: PageServerLoad = async ({ platform, url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	const page = parseSearchPage(url.searchParams.get('page'));
	const database = getDatabase(platform);

	if (!database) return searchFallback(query, page);

	try {
		return await searchContent(database, query, page);
	} catch (error) {
		console.error('Failed to search D1; using fallback data.', error);
		return searchFallback(query, page);
	}
};
