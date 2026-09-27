import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { AccountSecurityError, unbindGitHub } from '$lib/server/services/account-security';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	try {
		await unbindGitHub(requireDatabase(platform), locals.user.id);
		return json({ success: true });
	} catch (error) {
		if (error instanceof AccountSecurityError)
			return json({ error: error.message, field: error.field ?? null }, { status: error.status });
		console.error('GitHub unbind failed', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
