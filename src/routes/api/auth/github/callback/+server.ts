import { redirect } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import {
	exchangeGitHubCode,
	loginWithGitHub,
	OAUTH_STATE_COOKIE,
	validateOAuthState
} from '$lib/server/github-oauth';
import { setSessionCookie } from '$lib/server/user-auth';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ platform, cookies, url }) => {
	const code = url.searchParams.get('code'),
		state = url.searchParams.get('state'),
		stored = cookies.get(OAUTH_STATE_COOKIE);
	cookies.delete(OAUTH_STATE_COOKIE, { path: '/api/auth/github' });
	if (!code || !validateOAuthState(stored ?? null, state))
		return new Response('Invalid OAuth callback.', { status: 400 });
	const clientId = platform?.env?.GITHUB_CLIENT_ID,
		secret = platform?.env?.GITHUB_CLIENT_SECRET;
	if (!clientId || !secret) return new Response('GitHub OAuth is not configured.', { status: 503 });
	let session: { token: string; expires: Date };
	try {
		const profile = await exchangeGitHubCode(
			clientId,
			secret,
			code,
			new URL('/api/auth/github/callback', url.origin).toString()
		);
		session = await loginWithGitHub(requireDatabase(platform), profile);
	} catch (error) {
		console.error('GitHub OAuth callback failed', error);
		return new Response('GitHub login failed.', { status: 502 });
	}
	setSessionCookie(cookies, session.token, session.expires);
	redirect(303, '/');
};
