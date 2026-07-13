import { json } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import { clearSessionCookie, revokeSession, SESSION_COOKIE } from '$lib/server/user-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	const database = getDatabase(platform);
	if (token && database) await revokeSession(database, token);
	clearSessionCookie(cookies);
	return json({ success: true });
};
