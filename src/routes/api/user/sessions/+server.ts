import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { listUserSessions } from '$lib/server/services/account-security';
import { SESSION_COOKIE } from '$lib/server/user-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, platform, cookies }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	const sessions = await listUserSessions(
		requireDatabase(platform),
		locals.user.id,
		cookies.get(SESSION_COOKIE) ?? null
	);
	return json({ data: sessions });
};
