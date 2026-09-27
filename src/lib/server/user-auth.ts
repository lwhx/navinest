import type { Cookies } from '@sveltejs/kit';
import type { Database } from '$lib/server/db';
import {
	createPasswordHash,
	createSessionToken,
	hashSessionToken,
	normalizeLoginIdentifier,
	verifyPasswordHash
} from '$lib/server/auth';
import {
	displayNameError,
	emailError,
	normalizeEmail,
	normalizeUsername,
	passwordError,
	usernameError,
	type ValidationOutcome
} from '$lib/server/user-validation';

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

export type RegistrationInput = {
	username: string;
	displayName: string;
	email: string | null;
	password: string;
};

export class RegistrationError extends Error {
	constructor(
		message: string,
		public readonly field?: 'username' | 'email',
		public readonly status: 400 | 403 | 409 = 400
	) {
		super(message);
		this.name = 'RegistrationError';
	}
}

export function validateRegistrationInput(
	input: Record<string, unknown>
): ValidationOutcome<RegistrationInput> {
	const errors: Record<string, string> = {};
	const username = normalizeUsername(input.username);
	const usernameIssue = usernameError(username);
	if (usernameIssue) errors.username = usernameIssue;

	const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
	const displayNameIssue = displayNameError(displayName);
	if (displayNameIssue) errors.displayName = displayNameIssue;

	const email = normalizeEmail(input.email);
	const emailIssue = emailError(email);
	if (emailIssue) errors.email = emailIssue;

	const password = typeof input.password === 'string' ? input.password : '';
	const passwordIssue = passwordError(password, true);
	if (passwordIssue) errors.password = passwordIssue;

	return Object.keys(errors).length
		? { valid: false as const, errors }
		: { valid: true as const, data: { username, displayName, email: email || null, password } };
}

function registrationUniqueField(error: unknown) {
	if (!(error instanceof Error) || !/UNIQUE constraint failed/i.test(error.message)) return null;
	if (/users\.username/i.test(error.message)) return 'username' as const;
	if (/users\.email/i.test(error.message)) return 'email' as const;
	return null;
}

/** Public self-service registration: always creates an active plain user and logs them in. */
export async function registerUser(
	database: Database,
	input: RegistrationInput,
	context: SessionContext = {}
) {
	const passwordHash = await createPasswordHash(input.password);
	let userId: number;
	try {
		const row = (
			await database
				.prepare(
					`INSERT INTO users(email,username,display_name,role,status,password_hash)
					 VALUES(?,?,?,'user','active',?) RETURNING id`
				)
				.bind(input.email, input.username, input.displayName, passwordHash)
				.all<{ id: number }>()
		).results[0];
		if (!row) throw new RegistrationError('注册失败，请稍后再试。');
		userId = row.id;
	} catch (error) {
		const field = registrationUniqueField(error);
		if (field === 'username') throw new RegistrationError('该用户名已被使用。', 'username', 409);
		if (field === 'email') throw new RegistrationError('该邮箱已被使用。', 'email', 409);
		throw error;
	}
	const now = context.now ?? new Date();
	const session = await createUserSession(database, userId, { ...context, now });
	await database
		.prepare('UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?')
		.bind(userId)
		.all();
	return {
		user: {
			id: userId,
			email: input.email,
			username: input.username,
			displayName: input.displayName,
			role: 'user'
		},
		...session
	};
}
