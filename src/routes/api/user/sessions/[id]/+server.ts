import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { revokeUserSession } from '$lib/server/services/account-security';
import { SESSION_COOKIE } from '$lib/server/user-auth';
import type { RequestHandler } from './$types';

function sessionId(value: string) {
	return /^[0-9a-f]{16}$/.test(value) ? value : null;
}

export const DELETE: RequestHandler = async ({ locals, platform, params, cookies }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	const id = sessionId(params.id);
	if (!id) return json({ error: 'Invalid session ID' }, { status: 400 });
	const result = await revokeUserSession(
		requireDatabase(platform),
		locals.user.id,
		id,
		cookies.get(SESSION_COOKIE) ?? null
	);
	if (!result.revoked) return json({ error: 'Session not found' }, { status: 404 });
	return json({ success: true, wasCurrent: result.wasCurrent });
};
