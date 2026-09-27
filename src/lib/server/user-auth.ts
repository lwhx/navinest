import type { Cookies } from '@sveltejs/kit';
import type { Database } from '$lib/server/db';
import {
	createSessionToken,
	hashSessionToken,
	normalizeLoginIdentifier,
	verifyPasswordHash
} from '$lib/server/auth';

export const SESSION_COOKIE = 'navinest_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;
export type UserIdentity = {
	id: number;
	email: string | null;
	username: string;
	displayName: string;
	role: string;
};
type UserRow = {
	id: number;
	email: string | null;
	username: string;
	display_name: string;
	role: string;
	status: string;
	password_hash: string | null;
};

function identity(row: UserRow): UserIdentity {
	return {
		id: row.id,
		email: row.email,
		username: row.username,
		displayName: row.display_name,
		role: row.role
	};
}
export function loginAttemptKey(identifier: string, ip: string) {
	return `${normalizeLoginIdentifier(identifier)}|${ip}`;
}

export async function loginUser(
	database: Database,
	identifier: string,
	password: string,
	ip: string,
	options: { now?: Date; userAgent?: string | null } = {}
) {
	const now = options.now ?? new Date();
	const key = loginAttemptKey(identifier, ip);
	const attempt = (
		await database
			.prepare('SELECT failed_count, locked_until FROM login_attempts WHERE attempt_key = ?')
			.bind(key)
			.all<{ failed_count: number; locked_until: string | null }>()
	).results[0];
	if (attempt?.locked_until && new Date(attempt.locked_until) > now)
		return { ok: false as const, reason: 'locked' as const };
	const user = (
		await database
			.prepare(
				'SELECT id,email,username,display_name,role,status,password_hash FROM users WHERE lower(username)=? OR lower(email)=? LIMIT 1'
			)
			.bind(normalizeLoginIdentifier(identifier), normalizeLoginIdentifier(identifier))
			.all<UserRow>()
	).results[0];
	const valid = Boolean(
		user?.password_hash &&
		user.status === 'active' &&
		(await verifyPasswordHash(password, user.password_hash))
	);
	if (!valid) {
		const failures = (attempt?.failed_count ?? 0) + 1;
		const locked = failures >= 5 ? new Date(now.getTime() + 15 * 60_000).toISOString() : null;
		await database
			.prepare(
				`INSERT INTO login_attempts(attempt_key,failed_count,window_started_at,locked_until,updated_at) VALUES(?,?,?, ?,?) ON CONFLICT(attempt_key) DO UPDATE SET failed_count=excluded.failed_count,locked_until=excluded.locked_until,updated_at=excluded.updated_at`
			)
			.bind(key, failures, now.toISOString(), locked, now.toISOString())
			.all();
		return { ok: false as const, reason: locked ? ('locked' as const) : ('invalid' as const) };
	}
	await database
		.prepare('DELETE FROM login_attempts WHERE attempt_key IN (?, ?)')
		.bind(loginAttemptKey(user.username, ip), loginAttemptKey(user.email ?? user.username, ip))
		.all();
	const session = await createUserSession(database, user.id, {
		now,
		userAgent: options.userAgent ?? null,
		ipAddress: ip
	});
	await database
		.prepare('UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?')
		.bind(user.id)
		.all();
	return { ok: true as const, user: identity(user), ...session };
}
export type SessionContext = {
	now?: Date;
	userAgent?: string | null;
	ipAddress?: string | null;
};

function auditField(value: string | null | undefined, limit: number) {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return trimmed ? trimmed.slice(0, limit) : null;
}

export async function createUserSession(
	database: Database,
	userId: number,
	context: SessionContext = {}
) {
	const now = context.now ?? new Date();
	const token = createSessionToken();
	const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
	await database
		.prepare(
			'INSERT INTO user_sessions(token_hash,user_id,expires_at,user_agent,ip_address) VALUES(?,?,?,?,?)'
		)
		.bind(
			await hashSessionToken(token),
			userId,
			expires.toISOString(),
			auditField(context.userAgent, 255),
			auditField(context.ipAddress, 64)
		)
		.all();
	return { token, expires };
}

export async function sessionUser(database: Database, token: string, now = new Date()) {
	const row = (
		await database
			.prepare(
				`SELECT u.id,u.email,u.username,u.display_name,u.role,u.status,u.password_hash FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active' LIMIT 1`
			)
			.bind(await hashSessionToken(token), now.toISOString())
			.all<UserRow>()
	).results[0];
	return row ? identity(row) : null;
}
export async function revokeSession(database: Database, token: string) {
	await database
		.prepare('DELETE FROM user_sessions WHERE token_hash=?')
		.bind(await hashSessionToken(token))
		.all();
}
export function setSessionCookie(cookies: Cookies, token: string, expires: Date) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		expires
	});
}
export function clearSessionCookie(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
