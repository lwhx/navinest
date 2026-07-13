import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { markMessageRead, UserMessageError } from '$lib/server/services/user-messages';
import type { RequestHandler } from './$types';
export const PATCH: RequestHandler = async ({ locals, platform, params }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0)
		return json({ error: 'Invalid message ID' }, { status: 400 });
	try {
		await markMessageRead(requireDatabase(platform), locals.user.id, id);
		return json({ success: true });
	} catch (error) {
		if (error instanceof UserMessageError)
			return json({ error: error.message }, { status: error.status });
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
