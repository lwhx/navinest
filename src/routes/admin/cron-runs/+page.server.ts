import { getDatabase } from '$lib/server/db';
import { listCronRuns } from '$lib/server/services/cron-health';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ platform }) => {
	const db = getDatabase(platform);
	return {
		cron: '15 1 * * *',
		timezone: '北京时间每天 09:15',
		runs: db ? await listCronRuns(db) : []
	};
};
