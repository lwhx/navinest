import { error, redirect, type Handle } from '@sveltejs/kit';
import { adminLoginReturnTo } from '$lib/login-return';
import { adminAuthorizationContext, authorizeAdmin } from '$lib/server/admin-auth';
import { getDatabase } from '$lib/server/db';
import { sessionUser, SESSION_COOKIE } from '$lib/server/user-auth';
import {
	createCspNonce,
	requestSecurityHeaders,
	shouldPrivateNoStore,
	withScriptNonce
} from '$lib/server/security-headers';

function isAdminPath(pathname: string): boolean {
	return (
		pathname === '/admin' ||
		pathname.startsWith('/admin/') ||
		pathname === '/api/admin' ||
		pathname.startsWith('/api/admin/')
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.admin = null;
	event.locals.user = null;
	const database = getDatabase(event.platform);
	const sessionToken = event.cookies.get(SESSION_COOKIE);
	if (database && sessionToken) event.locals.user = await sessionUser(database, sessionToken);

	if (isAdminPath(event.url.pathname)) {
		const context = adminAuthorizationContext(event);
		const authorization = await authorizeAdmin(context);
		if (!authorization.authorized) {
			if (
				context.mode === 'session' &&
				authorization.status === 401 &&
				['GET', 'HEAD'].includes(event.request.method) &&
				(event.url.pathname === '/admin' || event.url.pathname.startsWith('/admin/'))
			) {
				const returnTo = adminLoginReturnTo(event.url.pathname + event.url.search);
				redirect(303, '/login?returnTo=' + encodeURIComponent(returnTo));
			}
			error(authorization.status, authorization.message);
		}
		event.locals.admin = authorization.identity;
	}

	const nonce = createCspNonce();
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => withScriptNonce(html, nonce)
	});
	for (const [name, value] of Object.entries(requestSecurityHeaders(nonce)))
		response.headers.set(name, value);
	if (shouldPrivateNoStore(event.url.pathname))
		response.headers.set('cache-control', 'private, no-store');
	return response;
};
