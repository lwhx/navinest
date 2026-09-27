import type { Database } from '$lib/server/db';
import { createPasswordHash, hashSessionToken, verifyPasswordHash } from '$lib/server/auth';

export class AccountSecurityError extends Error {
	constructor(
		message: string,
		public readonly field?: string,
		public readonly status: 400 | 401 | 403 | 404 | 409 = 400
	) {
		super(message);
		this.name = 'AccountSecurityError';
	}
}

type AccountRow = {
	id: number;
	username: string;
	email: string | null;
	role: string;
	status: string;
	password_hash: string | null;
};

type SessionRow = {
	token_hash: string;
	created_at: string;
	last_seen_at: string;
	expires_at: string;
	user_agent: string | null;
	ip_address: string | null;
};

export type UserSessionSummary = {
	id: string;
	createdAt: string;
	lastSeenAt: string;
	expiresAt: string;
	userAgent: string | null;
	ipAddress: string | null;
	current: boolean;
};

const MAX_LISTED_SESSIONS = 50;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Stable, non-reversible identifier for one stored session. The raw token hash never
 * leaves the server; the client only ever sees this derived value.
 */
export async function sessionPublicId(tokenHash: string): Promise<string> {
	return (await sha256Hex(`navinest-session:${tokenHash}`)).slice(0, 16);
}

async function loadAccount(database: Database, userId: number): Promise<AccountRow | null> {
	return (
		(
			await database
				.prepare('SELECT id,username,email,role,status,password_hash FROM users WHERE id=? LIMIT 1')
				.bind(userId)
				.all<AccountRow>()
		).results[0] ?? null
	);
}

async function sessionRows(database: Database, userId: number, now: Date) {
	return (
		await database
			.prepare(
				`SELECT token_hash,created_at,last_seen_at,expires_at,user_agent,ip_address
				 FROM user_sessions
				 WHERE user_id=? AND expires_at>?
				 ORDER BY last_seen_at DESC, created_at DESC
				 LIMIT ?`
			)
			.bind(userId, now.toISOString(), MAX_LISTED_SESSIONS)
			.all<SessionRow>()
	).results;
}

export async function listUserSessions(
	database: Database,
	userId: number,
	currentToken: string | null,
	now = new Date()
): Promise<UserSessionSummary[]> {
	const currentHash = currentToken ? await hashSessionToken(currentToken) : null;
	const summaries: UserSessionSummary[] = [];
	for (const row of await sessionRows(database, userId, now)) {
		summaries.push({
			id: await sessionPublicId(row.token_hash),
			createdAt: row.created_at,
			lastSeenAt: row.last_seen_at,
			expiresAt: row.expires_at,
			userAgent: row.user_agent,
			ipAddress: row.ip_address,
			current: currentHash !== null && row.token_hash === currentHash
		});
	}
	return summaries;
}

export async function revokeUserSession(
	database: Database,
	userId: number,
	sessionId: string,
	currentToken: string | null,
	now = new Date()
) {
	const currentHash = currentToken ? await hashSessionToken(currentToken) : null;
	const rows = await sessionRows(database, userId, now);
	for (const row of rows) {
		if ((await sessionPublicId(row.token_hash)) !== sessionId) continue;
		await database
			.prepare('DELETE FROM user_sessions WHERE user_id=? AND token_hash=?')
			.bind(userId, row.token_hash)
			.all();
		return { revoked: true, wasCurrent: currentHash !== null && row.token_hash === currentHash };
	}
	return { revoked: false, wasCurrent: false };
}

export async function revokeOtherSessions(
	database: Database,
	userId: number,
	currentToken: string | null,
	now = new Date()
) {
	const currentHash = currentToken ? await hashSessionToken(currentToken) : null;
	const active = await sessionRows(database, userId, now);
	const revoked = active.filter((row) => row.token_hash !== currentHash).length;
	if (currentHash === null)
		await database.prepare('DELETE FROM user_sessions WHERE user_id=?').bind(userId).all();
	else
		await database
			.prepare('DELETE FROM user_sessions WHERE user_id=? AND token_hash<>?')
			.bind(userId, currentHash)
			.all();
	return revoked;
}

export async function revokeAllSessions(database: Database, userId: number) {
	await database.prepare('DELETE FROM user_sessions WHERE user_id=?').bind(userId).all();
}

export function validatePasswordChangeInput(
	input: Record<string, unknown>,
	context: { username?: string | null } = {}
) {
	const errors: Record<string, string> = {};
	const currentPassword = typeof input.currentPassword === 'string' ? input.currentPassword : '';
	const newPassword = typeof input.newPassword === 'string' ? input.newPassword : '';
	const confirmation = typeof input.confirmPassword === 'string' ? input.confirmPassword : '';
	const username = (context.username ?? '').trim().toLowerCase();

	if (!currentPassword) errors.currentPassword = '请输入当前密码。';
	if (!newPassword) errors.newPassword = '请输入新密码。';
	else if (newPassword.length < MIN_PASSWORD_LENGTH)
		errors.newPassword = `新密码至少 ${MIN_PASSWORD_LENGTH} 个字符。`;
	else if (newPassword.length > MAX_PASSWORD_LENGTH)
		errors.newPassword = `新密码不能超过 ${MAX_PASSWORD_LENGTH} 个字符。`;
	else if (currentPassword && newPassword === currentPassword)
		errors.newPassword = '新密码不能与当前密码相同。';
	else if (username.length >= 3 && newPassword.toLowerCase().includes(username))
		errors.newPassword = '新密码不能包含用户名。';

	if (!errors.newPassword && newPassword && confirmation !== newPassword)
		errors.confirmPassword = '两次输入的新密码不一致。';

	return Object.keys(errors).length
		? { valid: false as const, errors }
		: { valid: true as const, data: { currentPassword, newPassword } };
}

export async function changePassword(
	database: Database,
	userId: number,
	currentPassword: string,
	newPassword: string,
	options: { keepToken?: string | null; now?: Date } = {}
) {
	const account = await loadAccount(database, userId);
	if (!account) throw new AccountSecurityError('账号不存在。', undefined, 404);
	if (account.status !== 'active')
		throw new AccountSecurityError('账号当前不可用，请联系管理员。', undefined, 403);
	if (!account.password_hash)
		throw new AccountSecurityError(
			'当前账号还没有密码，请先使用管理员设置密码后再修改。',
			'currentPassword',
			409
		);
	if (!(await verifyPasswordHash(currentPassword, account.password_hash)))
		throw new AccountSecurityError('当前密码不正确。', 'currentPassword', 401);
	if (await verifyPasswordHash(newPassword, account.password_hash))
		throw new AccountSecurityError('新密码不能与当前密码相同。', 'newPassword');

	const passwordHash = await createPasswordHash(newPassword);
	await database
		.prepare('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
		.bind(passwordHash, userId)
		.all();
	const revoked = await revokeOtherSessions(
		database,
		userId,
		options.keepToken ?? null,
		options.now ?? new Date()
	);
	return { revokedSessions: revoked };
}

export async function unbindGitHub(database: Database, userId: number) {
	const account = await loadAccount(database, userId);
	if (!account) throw new AccountSecurityError('账号不存在。', undefined, 404);
	if (!account.password_hash)
		throw new AccountSecurityError(
			'解绑 GitHub 后将无法登录，请先为账号设置密码。',
			undefined,
			409
		);
	const removed = (
		await database
			.prepare("DELETE FROM oauth_accounts WHERE user_id=? AND provider='github' RETURNING id")
			.bind(userId)
			.all<{ id: number }>()
	).results.length;
	if (!removed) throw new AccountSecurityError('当前账号未绑定 GitHub。', undefined, 404);
	return { unbound: true };
}

export async function deactivateAccount(
	database: Database,
	userId: number,
	input: { password?: unknown; confirmation?: unknown }
) {
	const account = await loadAccount(database, userId);
	if (!account) throw new AccountSecurityError('账号不存在。', undefined, 404);
	if (account.status !== 'active') throw new AccountSecurityError('账号已经停用。', undefined, 409);

	const password = typeof input.password === 'string' ? input.password : '';
	const confirmation =
		typeof input.confirmation === 'string' ? input.confirmation.trim().toLowerCase() : '';
	if (account.password_hash) {
		if (!password) throw new AccountSecurityError('请输入当前密码以确认注销。', 'password');
		if (!(await verifyPasswordHash(password, account.password_hash)))
			throw new AccountSecurityError('当前密码不正确。', 'password', 401);
	} else if (confirmation !== account.username.toLowerCase()) {
		throw new AccountSecurityError('请输入用户名以确认注销。', 'confirmation');
	}

	if (account.role === 'admin') {
		const remaining = Number(
			(
				await database
					.prepare(
						"SELECT COUNT(*) count FROM users WHERE role='admin' AND status='active' AND id<>?"
					)
					.bind(userId)
					.all<{ count: number }>()
			).results[0]?.count ?? 0
		);
		if (remaining === 0)
			throw new AccountSecurityError(
				'不能停用最后一个可用的管理员账号，请先指定其他管理员。',
				undefined,
				409
			);
	}

	await database
		.prepare("UPDATE users SET status='disabled',updated_at=CURRENT_TIMESTAMP WHERE id=?")
		.bind(userId)
		.all();
	await revokeAllSessions(database, userId);
	return { deactivated: true };
}
