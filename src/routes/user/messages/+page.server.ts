import { redirect } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { listUserMessages } from '$lib/server/services/user-messages';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user) redirect(303, '/login');
	return { messages: await listUserMessages(requireDatabase(platform), locals.user.id) };
};
