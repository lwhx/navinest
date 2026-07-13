import { json } from '@sveltejs/kit';
import { cacheControlFor } from '$lib/server/cache-policy';
import { requireDatabase } from '$lib/server/db';
import { listRankings, type RankingPeriod } from '$lib/server/services/rankings';
import type { RequestHandler } from './$types';
const periods = new Set<RankingPeriod>(['day', 'week', 'month', 'total']);
export const GET: RequestHandler = async ({ platform, url }) => {
	const raw = url.searchParams.get('period') ?? 'day';
	if (!periods.has(raw as RankingPeriod))
		return json({ error: 'Invalid ranking period' }, { status: 400 });
	const period = raw as RankingPeriod;
	return json(
		{ period, items: await listRankings(requireDatabase(platform), period) },
		{ headers: { 'cache-control': cacheControlFor('rankings') } }
	);
};
