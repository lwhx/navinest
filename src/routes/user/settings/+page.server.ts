import { redirect } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import { listUserSessions } from '$lib/server/services/account-security';
import { SESSION_COOKIE } from '$lib/server/user-auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
	if (!locals.user) redirect(303, '/login');
	const database = getDatabase(platform);
	if (!database) return { user: locals.user, github: false, hasPassword: false, sessions: [] };
	const account =
		(
			await database
				.prepare('SELECT password_hash FROM users WHERE id=? LIMIT 1')
				.bind(locals.user.id)
				.all<{ password_hash: string | null }>()
		).results[0] ?? null;
	const github = Boolean(
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
		hasPassword: Boolean(account?.password_hash),
		sessions
	};
};
