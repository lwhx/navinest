import type { RequestEvent } from '@sveltejs/kit';
import { verifyAccessAssertion } from '$lib/server/access-jwt';
import { getDatabase, type Database } from '$lib/server/db';
import type { UserIdentity } from '$lib/server/user-auth';

export type AdminAuthMode = 'access' | 'session';

export function adminAuthMode(value: string | undefined): AdminAuthMode {
	return value === 'session' ? 'session' : 'access';
}

export type AdminIdentity = {
	id: number | null;
	email: string;
	displayName: string;
	source: 'access' | 'session' | 'local';
};

export type AdminAuthorization =
	| { authorized: true; identity: AdminIdentity }
	| { authorized: false; status: 401 | 403 | 503; message: string };

type AdminUserRow = {
	id: number;
	email: string;
	display_name: string;
	role: string;
	status: string;
};

export type AdminAuthorizationContext = {
	database: Database | null;
	isLocal: boolean;
	assertion: string | null;
	mode?: AdminAuthMode;
	/** Cloudflare Access team domain (e.g. team.example.cloudflareaccess.com); access mode fails closed without it. */
	accessTeamDomain?: string | null;
	/** Optional Access application AUD tag to pin the token audience. */
	accessAud?: string | null;
	/** Injectable for tests; production uses global fetch. */
	accessFetch?: typeof fetch;
	/** Populated by the server hook from the current, active D1 session. */
	user?: UserIdentity | null;
};

export async function authorizeAdmin(
	context: AdminAuthorizationContext
): Promise<AdminAuthorization> {
	if (context.isLocal) {
		return {
			authorized: true,
			identity: {
				id: null,
				email: 'local-admin@navinest.test',
				displayName: '本地管理员',
				source: 'local'
			}
		};
	}

	if (context.mode === 'session') {
		if (!context.database)
			return { authorized: false, status: 503, message: 'Administrator database unavailable.' };
		if (!context.user)
			return { authorized: false, status: 401, message: 'Administrator sign-in required.' };
		if (context.user.role !== 'admin')
			return { authorized: false, status: 403, message: 'Administrator permission required.' };
		return {
			authorized: true,
			identity: {
				id: context.user.id,
				email: context.user.email ?? context.user.username,
				displayName: context.user.displayName,
				source: 'session'
			}
		};
	}

	if (!context.assertion) {
		return {
			authorized: false,
			status: 401,
			message: 'Cloudflare Access authentication required.'
		};
	}
	if (!context.accessTeamDomain) {
		return {
			authorized: false,
			status: 503,
			message: 'Access JWT verification is not configured; set CF_ACCESS_TEAM_DOMAIN.'
		};
	}
	const verification = await verifyAccessAssertion(context.assertion, {
		teamDomain: context.accessTeamDomain,
		aud: context.accessAud ?? null,
		fetcher: context.accessFetch
	});
	if (!verification.ok) {
		return {
			authorized: false,
			status: verification.reason === 'key-unavailable' ? 503 : 401,
			message: 'Cloudflare Access assertion rejected.'
		};
	}

	if (!context.database) {
		return { authorized: false, status: 503, message: 'Administrator database unavailable.' };
	}

	const { results } = await context.database
		.prepare(
			`SELECT id, email, display_name, role, status
			 FROM users
			 WHERE lower(email) = lower(?)
			 LIMIT 1`
		)
		.bind(verification.email)
		.all<AdminUserRow>();
	const user = results[0];

	if (!user || user.role !== 'admin' || user.status !== 'active') {
		return { authorized: false, status: 403, message: 'Administrator permission required.' };
	}

	return {
		authorized: true,
		identity: {
			id: user.id,
			email: user.email,
			displayName: user.display_name,
			source: 'access'
		}
	};
}

function isLocalRequest(event: RequestEvent): boolean {
	if (event.platform) return false;
	return ['127.0.0.1', 'localhost', '[::1]'].includes(event.url.hostname);
}

export function adminAuthorizationContext(event: RequestEvent): AdminAuthorizationContext {
	const env = event.platform?.env;
	return {
		database: getDatabase(event.platform),
		isLocal: isLocalRequest(event),
		assertion: event.request.headers.get('cf-access-jwt-assertion'),
		mode: adminAuthMode(env?.ADMIN_AUTH_MODE),
		accessTeamDomain: env?.CF_ACCESS_TEAM_DOMAIN || null,
		accessAud: env?.CF_ACCESS_AUD || null,
		user: event.locals.user
	};
}
