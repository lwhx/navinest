import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { createPasswordHash, hashSessionToken } from '$lib/server/auth';
import {
	AccountSecurityError,
	changePassword,
	deactivateAccount,
	listUserSessions,
	revokeOtherSessions,
	revokeUserSession,
	sessionPublicId,
	unbindGitHub,
	validatePasswordChangeInput
} from '$lib/server/services/account-security';

const connections: DatabaseSync[] = [];
const NOW = new Date('2026-09-27T10:00:00Z');
const CURRENT_TOKEN = 'current-session-token';
const OTHER_TOKEN = 'other-session-token';

async function fixture(options: { password?: boolean; role?: string } = {}) {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	const password = options.password === false ? null : await createPasswordHash('old-password-1');
	const role = options.role ?? 'user';
	sqlite.exec(
		`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,username TEXT,role TEXT,status TEXT,password_hash TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
		 CREATE TABLE user_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,user_agent TEXT,ip_address TEXT);
		 CREATE TABLE oauth_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,provider TEXT,provider_user_id TEXT,provider_username TEXT);`
	);
	sqlite
		.prepare('INSERT INTO users(id,email,username,role,status,password_hash) VALUES(1,?,?,?,?,?)')
		.run('blackice@example.com', 'blackice', role, 'active', password);
	for (const [token, , expires, agent, ip] of [
		[CURRENT_TOKEN, 1, '2026-10-27T10:00:00Z', 'Mozilla/5.0 Chrome/152 Windows', '203.0.113.9'],
		[OTHER_TOKEN, 2, '2026-10-27T10:00:00Z', 'Mozilla/5.0 Firefox/128 Linux', '203.0.113.10'],
		['expired-token', 3, '2026-01-01T00:00:00Z', 'Mozilla/5.0 Safari/18 macOS', '203.0.113.11']
	] as const) {
		sqlite
			.prepare(
				'INSERT INTO user_sessions(token_hash,user_id,expires_at,user_agent,ip_address) VALUES(?,1,?,?,?)'
			)
			.run(await hashSessionToken(token), expires, agent, ip);
	}
	const db: Database = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement: DatabaseStatement = {
				bind(...next) {
					values = next;
					return statement;
				},
				async all<T>() {
					return {
						results: sqlite
							.prepare(query)
							.all(...values.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v))) as T[]
					};
				}
			};
			return statement;
		}
	};
	return { sqlite, db };
}

afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('account security sessions', () => {
	it('lists active sessions with a stable public identifier and flags the current one', async () => {
		const { db } = await fixture();
		const sessions = await listUserSessions(db, 1, CURRENT_TOKEN, NOW);
		expect(sessions).toHaveLength(2);
		expect(sessions.map((session) => session.current)).toEqual([true, false]);
		expect(sessions[0]).toMatchObject({
			userAgent: 'Mozilla/5.0 Chrome/152 Windows',
			ipAddress: '203.0.113.9'
		});
		const tokenHash = await hashSessionToken(CURRENT_TOKEN);
		expect(sessions[0].id).toBe(await sessionPublicId(tokenHash));
		expect(sessions[0].id).not.toBe(tokenHash);
	});

	it('revokes a single session without touching the others', async () => {
		const { db, sqlite } = await fixture();
		const sessions = await listUserSessions(db, 1, CURRENT_TOKEN, NOW);
		const result = await revokeUserSession(db, 1, sessions[1].id, CURRENT_TOKEN, NOW);
		expect(result).toEqual({ revoked: true, wasCurrent: false });
		expect(
			sqlite.prepare('SELECT COUNT(*) count FROM user_sessions WHERE user_id=1').get()
		).toEqual({ count: 2 });
		expect(await revokeUserSession(db, 1, sessions[1].id, CURRENT_TOKEN, NOW)).toEqual({
			revoked: false,
			wasCurrent: false
		});
	});

	it('reports when the revoked session was the caller session', async () => {
		const { db } = await fixture();
		const sessions = await listUserSessions(db, 1, CURRENT_TOKEN, NOW);
		expect(await revokeUserSession(db, 1, sessions[0].id, CURRENT_TOKEN, NOW)).toEqual({
			revoked: true,
			wasCurrent: true
		});
	});

	it('revokes every other session and keeps the caller session', async () => {
		const { db, sqlite } = await fixture();
		expect(await revokeOtherSessions(db, 1, CURRENT_TOKEN, NOW)).toBe(1);
		const remaining = await listUserSessions(db, 1, CURRENT_TOKEN, NOW);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].current).toBe(true);
		expect(sqlite.prepare('SELECT token_hash FROM user_sessions WHERE user_id=1').all()).toEqual([
			{ token_hash: await hashSessionToken(CURRENT_TOKEN) }
		]);
	});
});

describe('password changes', () => {
	it('validates the requested password change before touching the database', () => {
		expect(
			validatePasswordChangeInput(
				{ currentPassword: 'old-password-1', newPassword: 'short', confirmPassword: 'short' },
				{ username: 'blackice' }
			)
		).toMatchObject({ valid: false, errors: { newPassword: expect.any(String) } });
		expect(
			validatePasswordChangeInput(
				{
					currentPassword: '',
					newPassword: 'a-long-enough-password',
					confirmPassword: 'a-long-enough-password'
				},
				{ username: 'blackice' }
			)
		).toMatchObject({ valid: false, errors: { currentPassword: expect.any(String) } });
		expect(
			validatePasswordChangeInput(
				{
					currentPassword: 'old-password-1',
					newPassword: 'reuse-blackice-key',
					confirmPassword: 'reuse-blackice-key'
				},
				{ username: 'blackice' }
			)
		).toMatchObject({ valid: false, errors: { newPassword: expect.any(String) } });
		expect(
			validatePasswordChangeInput(
				{
					currentPassword: 'old-password-1',
					newPassword: 'new-password-2',
					confirmPassword: 'different-password'
				},
				{ username: 'blackice' }
			)
		).toMatchObject({ valid: false, errors: { confirmPassword: expect.any(String) } });
		expect(
			validatePasswordChangeInput(
				{
					currentPassword: 'old-password-1',
					newPassword: 'new-password-2',
					confirmPassword: 'new-password-2'
				},
				{ username: 'blackice' }
			)
		).toEqual({
			valid: true,
			data: { currentPassword: 'old-password-1', newPassword: 'new-password-2' }
		});
	});

	it('rejects a wrong current password and leaves the hash untouched', async () => {
		const { db, sqlite } = await fixture();
		const before = sqlite.prepare('SELECT password_hash hash FROM users WHERE id=1').get();
		await expect(changePassword(db, 1, 'wrong-password', 'new-password-2')).rejects.toThrow(
			'当前密码不正确。'
		);
		expect(sqlite.prepare('SELECT password_hash hash FROM users WHERE id=1').get()).toEqual(before);
	});

	it('stores the new hash and revokes the other sessions only', async () => {
		const { db, sqlite } = await fixture();
		const result = await changePassword(db, 1, 'old-password-1', 'new-password-2', {
			keepToken: CURRENT_TOKEN,
			now: NOW
		});
		expect(result).toEqual({ revokedSessions: 1 });
		const stored = sqlite.prepare('SELECT password_hash hash FROM users WHERE id=1').get() as {
			hash: string;
		};
		expect(stored.hash.startsWith('pbkdf2-sha256-segmented$')).toBe(true);
		expect(sqlite.prepare('SELECT token_hash FROM user_sessions WHERE user_id=1').all()).toEqual([
			{ token_hash: await hashSessionToken(CURRENT_TOKEN) }
		]);
	});

	it('refuses accounts that have no password yet', async () => {
		const { db } = await fixture({ password: false });
		await expect(changePassword(db, 1, 'anything', 'new-password-2')).rejects.toBeInstanceOf(
			AccountSecurityError
		);
	});
});

describe('github binding and deactivation', () => {
	it('keeps the binding when the account would lose its last login method', async () => {
		const { db, sqlite } = await fixture({ password: false });
		sqlite
			.prepare(
				"INSERT INTO oauth_accounts(user_id,provider,provider_user_id,provider_username) VALUES(1,'github','4711','blackice')"
			)
			.run();
		await expect(unbindGitHub(db, 1)).rejects.toThrow('请先为账号设置密码');
		expect(sqlite.prepare('SELECT COUNT(*) count FROM oauth_accounts').get()).toEqual({ count: 1 });
	});

	it('unbinds github for accounts that still have a password', async () => {
		const { db, sqlite } = await fixture();
		sqlite
			.prepare(
				"INSERT INTO oauth_accounts(user_id,provider,provider_user_id,provider_username) VALUES(1,'github','4711','blackice')"
			)
			.run();
		expect(await unbindGitHub(db, 1)).toEqual({ unbound: true });
		expect(sqlite.prepare('SELECT COUNT(*) count FROM oauth_accounts').get()).toEqual({ count: 0 });
		await expect(unbindGitHub(db, 1)).rejects.toThrow('未绑定 GitHub');
	});

	it('requires the current password and disables the account with its sessions', async () => {
		const { db, sqlite } = await fixture();
		await expect(deactivateAccount(db, 1, { password: 'nope' })).rejects.toThrow(
			'当前密码不正确。'
		);
		expect(sqlite.prepare('SELECT status FROM users WHERE id=1').get()).toEqual({
			status: 'active'
		});
		expect(await deactivateAccount(db, 1, { password: 'old-password-1' })).toEqual({
			deactivated: true
		});
		expect(sqlite.prepare('SELECT status FROM users WHERE id=1').get()).toEqual({
			status: 'disabled'
		});
		expect(sqlite.prepare('SELECT COUNT(*) count FROM user_sessions').get()).toEqual({ count: 0 });
	});

	it('refuses to disable the last active administrator', async () => {
		const { db, sqlite } = await fixture({ role: 'admin' });
		await expect(deactivateAccount(db, 1, { password: 'old-password-1' })).rejects.toThrow(
			'不能停用最后一个可用的管理员账号'
		);
		sqlite
			.prepare(
				"INSERT INTO users(id,email,username,role,status) VALUES(2,'second@example.com','second','admin','active')"
			)
			.run();
		expect(await deactivateAccount(db, 1, { password: 'old-password-1' })).toEqual({
			deactivated: true
		});
	});

	it('accepts the typed username for accounts without a password', async () => {
		const { db, sqlite } = await fixture({ password: false });
		await expect(deactivateAccount(db, 1, { confirmation: 'wrong-name' })).rejects.toThrow(
			'请输入用户名以确认注销。'
		);
		expect(await deactivateAccount(db, 1, { confirmation: ' BlackIce ' })).toEqual({
			deactivated: true
		});
		expect(sqlite.prepare('SELECT status FROM users WHERE id=1').get()).toEqual({
			status: 'disabled'
		});
	});
});
