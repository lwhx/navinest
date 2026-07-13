import { getDatabase } from '$lib/server/db';
import { cacheControlFor } from '$lib/server/cache-policy';
import { listRankings, type RankingPeriod } from '$lib/server/services/rankings';
import type { PageServerLoad } from './$types';
const periods = new Set<RankingPeriod>(['day', 'week', 'month', 'total']);
export const load: PageServerLoad = async ({ platform, url, setHeaders }) => {
	setHeaders({ 'cache-control': cacheControlFor('rankings') });
	const raw = url.searchParams.get('period') ?? 'day';
	const period = periods.has(raw as RankingPeriod) ? (raw as RankingPeriod) : 'day';
	const db = getDatabase(platform);
	return { period, items: db ? await listRankings(db, period) : [] };
};
