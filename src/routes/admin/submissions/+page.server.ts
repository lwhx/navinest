import { getDatabase } from '$lib/server/db';
import { listAdminSubmissions } from '$lib/server/services/admin-submissions';
import { listCategories } from '$lib/server/services/categories';
import { listTags } from '$lib/server/services/tags';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ platform }) => {
	const db = getDatabase(platform);
	return {
		submissions: db ? await listAdminSubmissions(db) : [],
		categories: db ? await listCategories(db, { visibleOnly: false }) : [],
		tags: db ? await listTags(db) : [],
		source: db ? ('database' as const) : ('fallback' as const)
	};
};
