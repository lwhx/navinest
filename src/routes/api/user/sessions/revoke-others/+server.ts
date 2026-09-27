import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { revokeOtherSessions } from '$lib/server/services/account-security';
import { SESSION_COOKIE } from '$lib/server/user-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, platform, cookies }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	const revoked = await revokeOtherSessions(
		requireDatabase(platform),
		locals.user.id,
		cookies.get(SESSION_COOKIE) ?? null
	);
	return json({ success: true, revoked });
};
