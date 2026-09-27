import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { AccountSecurityError, deactivateAccount } from '$lib/server/services/account-security';
import { clearSessionCookie } from '$lib/server/user-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, platform, request, cookies }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!body || typeof body !== 'object' || Array.isArray(body))
		return json({ error: 'Invalid request' }, { status: 400 });
	const input = body as { password?: unknown; confirmation?: unknown };
	try {
		await deactivateAccount(requireDatabase(platform), locals.user.id, input);
		clearSessionCookie(cookies);
		return json({ success: true });
	} catch (error) {
		if (error instanceof AccountSecurityError)
			return json({ error: error.message, field: error.field ?? null }, { status: error.status });
		console.error('Account deactivation failed', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
