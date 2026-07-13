import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import {
	UserProfileError,
	updateUserProfile,
	validateUserProfileInput
} from '$lib/server/user-profile';
import type { RequestHandler } from './$types';
export const PATCH: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!body || typeof body !== 'object' || Array.isArray(body))
		return json({ error: 'Invalid request' }, { status: 400 });
	const validation = validateUserProfileInput(body as Record<string, unknown>);
	if (!validation.valid)
		return json({ error: 'Validation failed', fields: validation.errors }, { status: 400 });
	try {
		await updateUserProfile(requireDatabase(platform), locals.user.id, validation.data);
		return json({ success: true });
	} catch (error) {
		if (error instanceof UserProfileError)
			return json({ error: error.message, field: error.field ?? null }, { status: error.status });
		console.error('User profile update failed', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
