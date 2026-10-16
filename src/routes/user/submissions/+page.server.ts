import { redirect } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { loadUserSubmissions } from '$lib/server/services/user-submissions';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	if (!locals.user) redirect(303, '/login');
	const database = requireDatabase(platform);
	return loadUserSubmissions(database, locals.user.id, url.searchParams);
};
