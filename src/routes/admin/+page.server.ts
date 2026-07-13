import { getDatabase } from '$lib/server/db';
import { fallbackAdminOverview, loadAdminOverview } from '$lib/server/services/admin-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ platform }) => {
	const database = getDatabase(platform);
	return database ? loadAdminOverview(database) : fallbackAdminOverview();
};
