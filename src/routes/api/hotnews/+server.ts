import { json } from '@sveltejs/kit';
import { cacheControlFor } from '$lib/server/cache-policy';
import { requireDatabase } from '$lib/server/db';
import { listHotNews } from '$lib/server/services/hotnews-read';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ platform }) =>
	json(
		{ sources: await listHotNews(requireDatabase(platform)) },
		{ headers: { 'cache-control': cacheControlFor('realtime') } }
	);
