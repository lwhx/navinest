import { redirect } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { listUserSubmissions } from '$lib/server/services/submissions';
import { userSubmissionLinks } from '$lib/server/services/admin-submissions';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user) redirect(303, '/login');
	const database = requireDatabase(platform);
	const [submissions, publishedLinks] = await Promise.all([
		listUserSubmissions(database, locals.user.id),
		userSubmissionLinks(database, locals.user.id)
	]);
	return { submissions, publishedLinks };
};
