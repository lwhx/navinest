import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { loginUser, setSessionCookie } from '$lib/server/user-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, request, cookies, getClientAddress }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!body || typeof body !== 'object') return json({ error: 'Invalid request' }, { status: 400 });
	const { identifier, password } = body as Record<string, unknown>;
	if (
		typeof identifier !== 'string' ||
		typeof password !== 'string' ||
		!identifier.trim() ||
		!password
	)
		return json({ error: 'Identifier and password are required' }, { status: 400 });
	const result = await loginUser(
		requireDatabase(platform),
		identifier,
		password,
		getClientAddress()
	);
	if (!result.ok)
		return json(
			{ error: result.reason === 'locked' ? 'Too many login attempts' : 'Invalid credentials' },
			{ status: result.reason === 'locked' ? 429 : 401 }
		);
	setSessionCookie(cookies, result.token, result.expires);
	return json({ data: result.user });
};
