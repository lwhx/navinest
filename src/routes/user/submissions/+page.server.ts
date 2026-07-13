import { redirect } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { listUserSubmissions } from '$lib/server/services/submissions';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user) redirect(303, '/login');
	return { submissions: await listUserSubmissions(requireDatabase(platform), locals.user.id) };
};
