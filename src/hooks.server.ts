import { error, type Handle } from '@sveltejs/kit';
import { adminAuthorizationContext, authorizeAdmin } from '$lib/server/admin-auth';
import { getDatabase } from '$lib/server/db';
import { sessionUser, SESSION_COOKIE } from '$lib/server/user-auth';
import { securityHeaders, shouldPrivateNoStore } from '$lib/server/security-headers';

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
		const authorization = await authorizeAdmin(adminAuthorizationContext(event));
		if (!authorization.authorized) error(authorization.status, authorization.message);
		event.locals.admin = authorization.identity;
	}

	const response = await resolve(event);
	for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
	if (shouldPrivateNoStore(event.url.pathname))
		response.headers.set('cache-control', 'private, no-store');
	return response;
};
