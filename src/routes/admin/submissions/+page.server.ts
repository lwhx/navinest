import { getDatabase } from '$lib/server/db';
import { listAdminSubmissions } from '$lib/server/services/admin-submissions';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ platform }) => {
	const db = getDatabase(platform);
	return {
		submissions: db ? await listAdminSubmissions(db) : [],
		source: db ? ('database' as const) : ('fallback' as const)
	};
};
