import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import {
	AccountSecurityError,
	changePassword,
	validatePasswordChangeInput
} from '$lib/server/services/account-security';
import { SESSION_COOKIE } from '$lib/server/user-auth';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, platform, request, cookies }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!body || typeof body !== 'object' || Array.isArray(body))
		return json({ error: 'Invalid request' }, { status: 400 });
	const validation = validatePasswordChangeInput(body as Record<string, unknown>, {
		username: locals.user.username
	});
	if (!validation.valid)
		return json({ error: 'Validation failed', fields: validation.errors }, { status: 400 });
	try {
		const result = await changePassword(
			requireDatabase(platform),
			locals.user.id,
			validation.data.currentPassword,
			validation.data.newPassword,
			{ keepToken: cookies.get(SESSION_COOKIE) ?? null }
		);
		return json({ success: true, revokedSessions: result.revokedSessions });
	} catch (error) {
		if (error instanceof AccountSecurityError)
			return json({ error: error.message, field: error.field ?? null }, { status: error.status });
		console.error('Password change failed', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
