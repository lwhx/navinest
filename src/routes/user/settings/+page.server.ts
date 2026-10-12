import { redirect } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import { listUserSessions } from '$lib/server/services/account-security';
import { getShareSettings } from '$lib/server/services/share-pages';
import { SESSION_COOKIE } from '$lib/server/user-auth';
import { githubLoginEnabled } from '$lib/server/github-login';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
	if (!locals.user) redirect(303, '/login');
	const enabled = githubLoginEnabled(platform);
	const database = getDatabase(platform);
	if (!database)
		return {
			user: locals.user,
			github: false,
			githubLoginEnabled: enabled,
			hasPassword: false,
			sessions: [],
			share: { slug: '', enabled: false }
		};
	const account =
		(
			await database
				.prepare('SELECT password_hash FROM users WHERE id=? LIMIT 1')
				.bind(locals.user.id)
				.all<{ password_hash: string | null }>()
		).results[0] ?? null;
	const github =
		enabled &&
		Boolean(
			(
				await database
					.prepare("SELECT id FROM oauth_accounts WHERE user_id=? AND provider='github' LIMIT 1")
					.bind(locals.user.id)
					.all<{ id: number }>()
			).results[0]
		);
	const sessions = await listUserSessions(
		database,
		locals.user.id,
		cookies.get(SESSION_COOKIE) ?? null
	);
	return {
		user: locals.user,
		github,
		githubLoginEnabled: enabled,
		hasPassword: Boolean(account?.password_hash),
		sessions,
		share: await getShareSettings(database, locals.user.id)
	};
};
