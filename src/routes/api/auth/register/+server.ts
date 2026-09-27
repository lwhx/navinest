import { json } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { loadSiteSettings } from '$lib/server/services/site-settings';
import {
	registerUser,
	RegistrationError,
	setSessionCookie,
	validateRegistrationInput
} from '$lib/server/user-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request, cookies, getClientAddress }) => {
	if (!(await loadSiteSettings(getDatabase(platform))).registrationOpen)
		return json({ error: 'Registration is closed' }, { status: 403 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!body || typeof body !== 'object') return json({ error: 'Invalid request' }, { status: 400 });
	const validation = validateRegistrationInput(body as Record<string, unknown>);
	if (!validation.valid)
		return json({ error: 'Invalid request', errors: validation.errors }, { status: 400 });
	try {
		const result = await registerUser(requireDatabase(platform), validation.data, {
			userAgent: request.headers.get('user-agent'),
			ipAddress: getClientAddress()
		});
		setSessionCookie(cookies, result.token, result.expires);
		return json({ data: result.user }, { status: 201 });
	} catch (error) {
		if (error instanceof RegistrationError)
			return json({ error: error.message }, { status: error.status });
		throw error;
	}
};
