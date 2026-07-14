import { redirect } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import { listCategories } from '$lib/server/services/categories';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user) redirect(303, '/login');
	const database = getDatabase(platform);
	return {
		user: locals.user,
		categories: database ? await listCategories(database, { visibleOnly: true }) : []
	};
};
