import type { RequestEvent } from '@sveltejs/kit';
import { getDatabase, type Database } from '$lib/server/db';

export type AdminIdentity = {
	id: number | null;
	email: string;
	displayName: string;
	source: 'access' | 'local';
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
	email: string | null;
	assertion: string | null;
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

	if (!context.email || !context.assertion) {
		return {
			authorized: false,
			status: 401,
			message: 'Cloudflare Access authentication required.'
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
		.bind(context.email)
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
	return {
		database: getDatabase(event.platform),
		isLocal: isLocalRequest(event),
		email: event.request.headers.get('cf-access-authenticated-user-email'),
		assertion: event.request.headers.get('cf-access-jwt-assertion')
	};
}
