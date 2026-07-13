import { redirect } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import { getUserProfile } from '$lib/server/user-profile';
import { listFavorites, listFootprints } from '$lib/server/services/user-activity';
import { listCustomNavigation } from '$lib/server/services/custom-navigation';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user) redirect(303, '/login');
	const db = getDatabase(platform);
	const github = db
		? Boolean(
				(
					await db
						.prepare(`SELECT id FROM oauth_accounts WHERE user_id=? AND provider='github' LIMIT 1`)
						.bind(locals.user.id)
						.all<{ id: number }>()
				).results[0]
			)
		: false;
	const profile = db ? await getUserProfile(db, locals.user.id) : null;
	const [favorites, footprints, navigation] = db
		? await Promise.all([
				listFavorites(db, locals.user.id),
				listFootprints(db, locals.user.id),
				listCustomNavigation(db, locals.user.id)
			])
		: [[], [], { categories: [], links: [] }];
	return { user: locals.user, github, profile, favorites, footprints, navigation };
};
