import type { Database } from '$lib/server/db';
import { createPasswordHash } from '$lib/server/auth';
import { AdminWriteError } from '$lib/server/services/admin-write';
import {
	displayNameError,
	emailError,
	normalizeEmail,
	normalizeUsername,
	passwordError,
	usernameError
} from '$lib/server/user-validation';
import type { ValidationResult } from '$lib/server/admin-validation';

export const USER_ROLES = ['user', 'admin'] as const;
export const USER_STATUSES = ['active', 'disabled'] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];

export type AdminUserInput = {
	username: string;
	displayName: string;
	email: string | null;
	role: UserRole;
	status: UserStatus;
	password: string | null;
};

export type AdminUserSummary = {
	id: number;
	username: string;
	displayName: string;
	email: string | null;
	role: string;
	status: string;
	createdAt: string;
	lastLoginAt: string | null;
	github: boolean;
	favorites: number;
	footprints: number;
	submissions: number;
	sessions: number;
};

type UserRow = {
	id: number;
	username: string;
	display_name: string;
	email: string | null;
	role: string;
	status: string;
	created_at: string;
	last_login_at: string | null;
	github: number;
	favorites: number;
	footprints: number;
	submissions: number;
	sessions: number;
};

export function validateAdminUserInput(
	input: Record<string, unknown>,
	options: { requirePassword: boolean }
): ValidationResult<AdminUserInput> {
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

	const role = typeof input.role === 'string' ? input.role : 'user';
	if (!USER_ROLES.includes(role as UserRole)) errors.role = '角色无效。';

	const status = typeof input.status === 'string' ? input.status : 'active';
	if (!USER_STATUSES.includes(status as UserStatus)) errors.status = '状态无效。';

	const password = typeof input.password === 'string' ? input.password : '';
	const passwordIssue = passwordError(password, options.requirePassword);
	if (passwordIssue) errors.password = passwordIssue;

	return Object.keys(errors).length
		? { valid: false as const, errors }
		: {
				valid: true as const,
				data: {
					username,
					displayName,
					email: email || null,
					role: role as UserRole,
					status: status as UserStatus,
					password: password || null
				}
			};
}

export async function listAdminUsers(database: Database): Promise<AdminUserSummary[]> {
	const { results } = await database
		.prepare(
			`SELECT u.id,u.username,u.display_name,u.email,u.role,u.status,u.created_at,u.last_login_at,
			 EXISTS(SELECT 1 FROM oauth_accounts o WHERE o.user_id=u.id AND o.provider='github') github,
			 (SELECT COUNT(*) FROM favorites f WHERE f.user_id=u.id) favorites,
			 (SELECT COUNT(*) FROM footprints p WHERE p.user_id=u.id) footprints,
			 (SELECT COUNT(*) FROM submissions s WHERE s.user_id=u.id) submissions,
			 (SELECT COUNT(*) FROM user_sessions x WHERE x.user_id=u.id AND x.expires_at>datetime('now')) sessions
			 FROM users u
			 ORDER BY CASE u.role WHEN 'admin' THEN 0 ELSE 1 END, u.id
			 LIMIT 200`
		)
		.all<UserRow>();
	return results.map((row) => ({
		id: row.id,
		username: row.username,
		displayName: row.display_name,
		email: row.email,
		role: row.role,
		status: row.status,
		createdAt: row.created_at,
		lastLoginAt: row.last_login_at,
		github: Boolean(row.github),
		favorites: Number(row.favorites),
		footprints: Number(row.footprints),
		submissions: Number(row.submissions),
		sessions: Number(row.sessions)
	}));
}

async function loadUser(database: Database, userId: number) {
	return (
		(
			await database
				.prepare('SELECT id,username,role,status,password_hash FROM users WHERE id=? LIMIT 1')
				.bind(userId)
				.all<{
					id: number;
					username: string;
					role: string;
					status: string;
					password_hash: string | null;
				}>()
		).results[0] ?? null
	);
}

async function assertAnotherActiveAdmin(database: Database, userId: number) {
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
		throw new AdminWriteError('站点必须保留至少一个可用的管理员账号。', 'role', 409);
}

function uniqueField(error: unknown): string | null {
	if (!(error instanceof Error)) return null;
	if (!/UNIQUE constraint failed/i.test(error.message)) return null;
	if (/users\.username/i.test(error.message)) return 'username';
	if (/users\.email/i.test(error.message)) return 'email';
	return null;
}

export async function createAdminUser(database: Database, input: AdminUserInput) {
	const passwordHash = input.password ? await createPasswordHash(input.password) : null;
	try {
		const row = (
			await database
				.prepare(
					`INSERT INTO users(email,username,display_name,role,status,password_hash)
					 VALUES(?,?,?,?,?,?) RETURNING id`
				)
				.bind(
					input.email,
					input.username,
					input.displayName,
					input.role,
					input.status,
					passwordHash
				)
				.all<{ id: number }>()
		).results[0];
		if (!row) throw new AdminWriteError('创建用户失败。');
		return row.id;
	} catch (error) {
		const field = uniqueField(error);
		if (field === 'username') throw new AdminWriteError('用户名已被使用。', 'username', 409);
		if (field === 'email') throw new AdminWriteError('邮箱已被使用。', 'email', 409);
		throw error;
	}
}

export async function updateAdminUser(database: Database, userId: number, input: AdminUserInput) {
	const current = await loadUser(database, userId);
	if (!current) throw new AdminWriteError('用户不存在。', undefined, 404);
	if (
		current.role === 'admin' &&
		current.status === 'active' &&
		(input.role !== 'admin' || input.status !== 'active')
	)
		await assertAnotherActiveAdmin(database, userId);
	try {
		await database
			.prepare(
				`UPDATE users SET email=?,username=?,display_name=?,role=?,status=?,updated_at=CURRENT_TIMESTAMP
				 WHERE id=?`
			)
			.bind(input.email, input.username, input.displayName, input.role, input.status, userId)
			.all();
	} catch (error) {
		const field = uniqueField(error);
		if (field === 'username') throw new AdminWriteError('用户名已被使用。', 'username', 409);
		if (field === 'email') throw new AdminWriteError('邮箱已被使用。', 'email', 409);
		throw error;
	}
	if (input.status === 'disabled')
		await database.prepare('DELETE FROM user_sessions WHERE user_id=?').bind(userId).all();
}

export async function resetAdminUserPassword(database: Database, userId: number, password: string) {
	const passwordIssue = passwordError(password, true);
	if (passwordIssue) throw new AdminWriteError(passwordIssue, 'password');
	const current = await loadUser(database, userId);
	if (!current) throw new AdminWriteError('用户不存在。', undefined, 404);
	const passwordHash = await createPasswordHash(password);
	await database
		.prepare('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
		.bind(passwordHash, userId)
		.all();
	await database.prepare('DELETE FROM user_sessions WHERE user_id=?').bind(userId).all();
}

export async function setAdminUserStatus(database: Database, userId: number, status: UserStatus) {
	const current = await loadUser(database, userId);
	if (!current) throw new AdminWriteError('用户不存在。', undefined, 404);
	if (current.role === 'admin' && current.status === 'active' && status !== 'active')
		await assertAnotherActiveAdmin(database, userId);
	await database
		.prepare('UPDATE users SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
		.bind(status, userId)
		.all();
	if (status === 'disabled')
		await database.prepare('DELETE FROM user_sessions WHERE user_id=?').bind(userId).all();
}
