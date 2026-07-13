import { getDatabase } from '$lib/server/db';
import { cacheControlFor } from '$lib/server/cache-policy';
import { listHotNews } from '$lib/server/services/hotnews-read';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ platform, setHeaders }) => {
	setHeaders({ 'cache-control': cacheControlFor('realtime') });
	const db = getDatabase(platform);
	return { sources: db ? await listHotNews(db) : [] };
};
