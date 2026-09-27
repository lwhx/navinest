import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	createOAuthState,
	loginWithGitHub,
	normalizeGitHubProfile,
	validateOAuthState
} from '$lib/server/github-oauth';

const connections: DatabaseSync[] = [];
function oauthFixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE,username TEXT UNIQUE,display_name TEXT,role TEXT,status TEXT,last_login_at TEXT);
CREATE TABLE oauth_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,provider TEXT,provider_user_id TEXT,provider_username TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(provider,provider_user_id));
CREATE TABLE user_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,user_agent TEXT,ip_address TEXT);`);
	const database: Database = {
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
							.all(
								...values.map((value) =>
									value instanceof ArrayBuffer ? new Uint8Array(value) : value
								)
							) as T[]
					};
				}
			};
			return statement;
		}
	};
	return { sqlite, database };
}
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

const unknownProfile = {
	providerUserId: '9001',
	providerUsername: 'stranger',
	email: 'stranger@example.com',
	usernameCandidate: 'stranger',
	displayName: 'Stranger',
	avatarUrl: null
};

describe('GitHub OAuth account provisioning', () => {
	it('rejects an unknown GitHub identity when auto provisioning is disabled', async () => {
		const { database, sqlite } = oauthFixture();
		await expect(loginWithGitHub(database, unknownProfile, false)).rejects.toThrow('registration');
		expect(sqlite.prepare('SELECT COUNT(*) count FROM users').get()).toEqual({ count: 0 });
	});

	it('continues to bind a verified GitHub identity to an existing local email', async () => {
		const { database, sqlite } = oauthFixture();
		sqlite.exec(
			"INSERT INTO users(email,username,display_name,role,status) VALUES('stranger@example.com','existing','Existing','user','active')"
		);
		await expect(loginWithGitHub(database, unknownProfile, false)).resolves.toMatchObject({
			user: { username: 'existing' }
		});
		expect(sqlite.prepare('SELECT provider_user_id FROM oauth_accounts').get()).toEqual({
			provider_user_id: '9001'
		});
	});
});

describe('GitHub OAuth state', () => {
	it('creates an opaque state and validates an exact callback match', () => {
		const state = createOAuthState(Uint8Array.from({ length: 32 }, (_, index) => index));
		expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(validateOAuthState(state, state)).toBe(true);
		expect(validateOAuthState(state, `${state}x`)).toBe(false);
		expect(validateOAuthState(null, state)).toBe(false);
	});
});

describe('GitHub profile normalization', () => {
	it('uses the verified primary email and a stable username candidate', () => {
		expect(
			normalizeGitHubProfile(
				{
					id: 42,
					login: 'Octo-Cat',
					name: ' Octo Cat ',
					email: null,
					avatar_url: 'https://avatars.githubusercontent.com/u/42'
				},
				[
					{ email: 'other@example.com', primary: false, verified: true },
					{ email: 'OCTO@example.com', primary: true, verified: true }
				]
			)
		).toEqual({
			providerUserId: '42',
			providerUsername: 'Octo-Cat',
			email: 'octo@example.com',
			usernameCandidate: 'octo-cat',
			displayName: 'Octo Cat',
			avatarUrl: 'https://avatars.githubusercontent.com/u/42'
		});
	});

	it('rejects profiles without a verified email', () => {
		expect(() =>
			normalizeGitHubProfile(
				{ id: 7, login: 'private', name: null, email: null, avatar_url: null },
				[{ email: 'hidden@example.com', primary: true, verified: false }]
			)
		).toThrow('verified email');
	});
});
