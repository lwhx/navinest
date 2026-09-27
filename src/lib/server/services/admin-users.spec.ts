import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { verifyPasswordHash } from '$lib/server/auth';
import { AdminWriteError } from '$lib/server/services/admin-write';
import {
	createAdminUser,
	listAdminUsers,
	resetAdminUserPassword,
	setAdminUserStatus,
	updateAdminUser,
	validateAdminUserInput,
	type AdminUserInput
} from '$lib/server/services/admin-users';

const connections: DatabaseSync[] = [];

function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE,username TEXT UNIQUE,display_name TEXT,password_hash TEXT,avatar_file_id INTEGER,cover_file_id INTEGER,role TEXT,status TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,last_login_at TEXT);
CREATE TABLE oauth_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,provider TEXT,provider_user_id TEXT,provider_username TEXT);
CREATE TABLE user_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at TEXT);
CREATE TABLE favorites(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,item_id INTEGER);
CREATE TABLE footprints(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,item_id INTEGER);
CREATE TABLE submissions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,status TEXT);
INSERT INTO users(id,email,username,display_name,role,status) VALUES(1,'admin@example.com','admin','Admin','admin','active'),(2,NULL,'blackice','Black Ice','user','active');
INSERT INTO oauth_accounts(user_id,provider,provider_user_id,provider_username) VALUES(1,'github','4711','admin');
INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES('active-a',1,'2099-01-01T00:00:00Z'),('expired-a',1,'2000-01-01T00:00:00Z'),('active-b',2,'2099-01-01T00:00:00Z');
INSERT INTO favorites(user_id,item_id) VALUES(2,1),(2,2);
INSERT INTO footprints(user_id,item_id) VALUES(2,3);
INSERT INTO submissions(user_id,status) VALUES(2,'published'),(2,'pending');
`);
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

const validInput: AdminUserInput = {
	username: 'newcomer',
	displayName: 'New Comer',
	email: 'NEWCOMER@example.com ',
	role: 'user',
	status: 'active',
	password: 'initial-password-1'
};

describe('administrator user input validation', () => {
	it('normalizes identifiers and requires an initial password', () => {
		expect(validateAdminUserInput(validInput, { requirePassword: true })).toEqual({
			valid: true,
			data: {
				username: 'newcomer',
				displayName: 'New Comer',
				email: 'newcomer@example.com',
				role: 'user',
				status: 'active',
				password: 'initial-password-1'
			}
		});
		expect(
			validateAdminUserInput({ ...validInput, password: '' }, { requirePassword: true })
		).toMatchObject({ valid: false, errors: { password: expect.any(String) } });
	});

	it('rejects malformed usernames, emails, roles and statuses', () => {
		expect(
			validateAdminUserInput(
				{
					...validInput,
					username: '-bad name',
					email: 'not-an-email',
					role: 'root',
					status: 'zombie'
				},
				{ requirePassword: false }
			)
		).toMatchObject({
			valid: false,
			errors: {
				username: expect.any(String),
				email: expect.any(String),
				role: expect.any(String),
				status: expect.any(String)
			}
		});
	});

	it('treats the password as optional for updates', () => {
		expect(
			validateAdminUserInput({ ...validInput, password: '' }, { requirePassword: false })
		).toMatchObject({ valid: true, data: { password: null } });
	});
});

describe('administrator user records', () => {
	it('creates a user with a hashed password', async () => {
		const { db, sqlite } = fixture();
		const id = await createAdminUser(db, {
			...validInput,
			email: 'newcomer@example.com',
			role: 'user',
			status: 'active',
			password: 'initial-password-1'
		});
		const stored = sqlite
			.prepare('SELECT username,email,role,status,password_hash FROM users WHERE id=?')
			.get(id) as { username: string; email: string; password_hash: string; role: string };
		expect(stored.username).toBe('newcomer');
		expect(stored.email).toBe('newcomer@example.com');
		expect(stored.password_hash.startsWith('pbkdf2-sha256-segmented$')).toBe(true);
		expect(await verifyPasswordHash('initial-password-1', stored.password_hash)).toBe(true);
	});

	it('reports duplicate usernames and emails as conflicts', async () => {
		const { db } = fixture();
		await expect(
			createAdminUser(db, { ...validInput, email: null, password: 'initial-password-1' }).then(() =>
				createAdminUser(db, { ...validInput, email: null })
			)
		).rejects.toMatchObject({ status: 409, field: 'username' });
		await expect(
			createAdminUser(db, {
				...validInput,
				username: 'other',
				email: 'admin@example.com',
				password: 'initial-password-1'
			})
		).rejects.toMatchObject({ status: 409, field: 'email' });
	});

	it('lists administrators first with activity and active session counts', async () => {
		const { db } = fixture();
		const users = await listAdminUsers(db);
		expect(users.map((user) => user.username)).toEqual(['admin', 'blackice']);
		expect(users[0]).toMatchObject({ github: true, sessions: 1, favorites: 0, submissions: 0 });
		expect(users[1]).toMatchObject({
			github: false,
			sessions: 1,
			favorites: 2,
			footprints: 1,
			submissions: 2
		});
	});

	it('updates profile fields and revokes sessions when disabling an account', async () => {
		const { db, sqlite } = fixture();
		await updateAdminUser(db, 2, {
			username: 'blackice',
			displayName: 'Black Ice II',
			email: 'blackice@example.com',
			role: 'user',
			status: 'disabled',
			password: null
		});
		expect(sqlite.prepare('SELECT display_name,status FROM users WHERE id=2').get()).toEqual({
			display_name: 'Black Ice II',
			status: 'disabled'
		});
		expect(
			sqlite.prepare('SELECT COUNT(*) count FROM user_sessions WHERE user_id=2').get()
		).toEqual({ count: 0 });
	});

	it('keeps at least one usable administrator', async () => {
		const { db } = fixture();
		await expect(
			updateAdminUser(db, 1, {
				username: 'admin',
				displayName: 'Admin',
				email: 'admin@example.com',
				role: 'user',
				status: 'active',
				password: null
			})
		).rejects.toMatchObject({ status: 409, field: 'role' });
		await expect(
			updateAdminUser(db, 1, {
				username: 'admin',
				displayName: 'Admin',
				email: 'admin@example.com',
				role: 'admin',
				status: 'disabled',
				password: null
			})
		).rejects.toBeInstanceOf(AdminWriteError);
	});

	it('allows demoting an administrator once another active administrator exists', async () => {
		const { db } = fixture();
		await createAdminUser(db, {
			...validInput,
			username: 'secondadmin',
			email: 'second@example.com',
			role: 'admin',
			status: 'active',
			password: 'initial-password-1'
		});
		await updateAdminUser(db, 1, {
			username: 'admin',
			displayName: 'Admin',
			email: 'admin@example.com',
			role: 'user',
			status: 'active',
			password: null
		});
		const users = await listAdminUsers(db);
		expect(users.find((user) => user.id === 1)?.role).toBe('user');
	});

	it('resets passwords and forces a fresh login', async () => {
		const { db, sqlite } = fixture();
		await resetAdminUserPassword(db, 2, 'brand-new-password');
		const stored = sqlite.prepare('SELECT password_hash hash FROM users WHERE id=2').get() as {
			hash: string;
		};
		expect(await verifyPasswordHash('brand-new-password', stored.hash)).toBe(true);
		expect(
			sqlite.prepare('SELECT COUNT(*) count FROM user_sessions WHERE user_id=2').get()
		).toEqual({ count: 0 });
		await expect(resetAdminUserPassword(db, 2, 'short')).rejects.toMatchObject({
			status: 400,
			field: 'password'
		});
		await expect(resetAdminUserPassword(db, 99, 'brand-new-password')).rejects.toMatchObject({
			status: 404
		});
	});

	it('toggles account status through the quick action and keeps the last administrator', async () => {
		const { db, sqlite } = fixture();
		await setAdminUserStatus(db, 2, 'disabled');
		expect(sqlite.prepare('SELECT status FROM users WHERE id=2').get()).toEqual({
			status: 'disabled'
		});
		expect(
			sqlite.prepare('SELECT COUNT(*) count FROM user_sessions WHERE user_id=2').get()
		).toEqual({ count: 0 });
		await setAdminUserStatus(db, 2, 'active');
		expect(sqlite.prepare('SELECT status FROM users WHERE id=2').get()).toEqual({
			status: 'active'
		});
		await expect(setAdminUserStatus(db, 1, 'disabled')).rejects.toMatchObject({ status: 409 });
		await expect(setAdminUserStatus(db, 99, 'active')).rejects.toMatchObject({ status: 404 });
	});
});
