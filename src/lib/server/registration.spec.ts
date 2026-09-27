import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { verifyPasswordHash } from '$lib/server/auth';
import { registerUser, RegistrationError, validateRegistrationInput } from '$lib/server/user-auth';

const connections: DatabaseSync[] = [];

function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE,username TEXT UNIQUE,display_name TEXT,password_hash TEXT,role TEXT,status TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,last_login_at TEXT);
CREATE TABLE user_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,user_agent TEXT,ip_address TEXT);
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

describe('registration input validation', () => {
	it('normalises identifiers and accepts a minimal submission', () => {
		expect(
			validateRegistrationInput({
				username: '  New.Comer ',
				displayName: ' 新同学 ',
				email: ' NewComer@Example.COM ',
				password: 'password-123'
			})
		).toEqual({
			valid: true,
			data: {
				username: 'new.comer',
				displayName: '新同学',
				email: 'newcomer@example.com',
				password: 'password-123'
			}
		});
		expect(
			validateRegistrationInput({
				username: 'newcomer',
				displayName: '新同学',
				email: '',
				password: 'password-123'
			})
		).toMatchObject({ valid: true, data: { email: null } });
	});

	it('reports every missing or malformed field', () => {
		expect(validateRegistrationInput({})).toMatchObject({
			valid: false,
			errors: {
				username: expect.any(String),
				displayName: expect.any(String),
				password: expect.any(String)
			}
		});
		expect(
			validateRegistrationInput({
				username: 'x',
				displayName: '名字',
				email: 'not-an-email',
				password: 'short'
			})
		).toMatchObject({
			valid: false,
			errors: {
				username: expect.any(String),
				email: expect.any(String),
				password: expect.any(String)
			}
		});
	});
});

describe('public registration', () => {
	it('creates an active plain user, hashes the password and signs them in', async () => {
		const { sqlite, db } = fixture();
		const result = await registerUser(
			db,
			{
				username: 'newcomer',
				displayName: '新同学',
				email: 'newcomer@example.com',
				password: 'password-123'
			},
			{ userAgent: 'Mozilla/5.0 Test', ipAddress: '203.0.113.9' }
		);
		expect(result.user).toMatchObject({
			username: 'newcomer',
			displayName: '新同学',
			email: 'newcomer@example.com',
			role: 'user'
		});
		expect(result.token).toHaveLength(43);
		const stored = sqlite
			.prepare('SELECT username,role,status,password_hash,last_login_at FROM users WHERE id=?')
			.get(result.user.id) as {
			username: string;
			role: string;
			status: string;
			password_hash: string;
			last_login_at: string | null;
		};
		expect(stored.role).toBe('user');
		expect(stored.status).toBe('active');
		expect(stored.password_hash.startsWith('pbkdf2-sha256-segmented$')).toBe(true);
		expect(await verifyPasswordHash('password-123', stored.password_hash)).toBe(true);
		expect(stored.last_login_at).not.toBeNull();
		expect(
			sqlite
				.prepare('SELECT user_agent,ip_address FROM user_sessions WHERE user_id=?')
				.get(result.user.id)
		).toEqual({ user_agent: 'Mozilla/5.0 Test', ip_address: '203.0.113.9' });
	});

	it('refuses duplicate usernames and emails with a conflict', async () => {
		const { db } = fixture();
		const base = {
			username: 'newcomer',
			displayName: '新同学',
			email: 'newcomer@example.com',
			password: 'password-123'
		};
		await registerUser(db, base);
		await expect(registerUser(db, base)).rejects.toMatchObject({
			status: 409,
			field: 'username'
		});
		await expect(
			registerUser(db, { ...base, username: 'another', email: 'newcomer@example.com' })
		).rejects.toMatchObject({ status: 409, field: 'email' });
		await expect(
			registerUser(db, { ...base, username: 'another', email: null })
		).resolves.toMatchObject({ user: { username: 'another' } });
	});

	it('keeps passwords out of the returned identity and surfaces typed errors', async () => {
		const { db } = fixture();
		const result = await registerUser(db, {
			username: 'newcomer',
			displayName: '新同学',
			email: null,
			password: 'password-123'
		});
		expect(JSON.stringify(result.user)).not.toContain('password');
		await expect(
			registerUser(db, {
				username: 'newcomer',
				displayName: 'Dup',
				email: null,
				password: 'password-123'
			})
		).rejects.toBeInstanceOf(RegistrationError);
	});
});
