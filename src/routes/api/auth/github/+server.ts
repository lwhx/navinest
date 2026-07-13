import { redirect } from '@sveltejs/kit';
import { createOAuthState, githubAuthorizeUrl, OAUTH_STATE_COOKIE } from '$lib/server/github-oauth';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ platform, cookies, url }) => {
	const clientId = platform?.env?.GITHUB_CLIENT_ID;
	if (!clientId) return new Response('GitHub OAuth is not configured.', { status: 503 });
	const state = createOAuthState();
	cookies.set(OAUTH_STATE_COOKIE, state, {
		path: '/api/auth/github',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: 600
	});
	const callback = new URL('/api/auth/github/callback', url.origin).toString();
	redirect(302, githubAuthorizeUrl(clientId, state, callback));
};
