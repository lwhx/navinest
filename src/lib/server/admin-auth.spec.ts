import { describe, expect, it } from 'vitest';
import type { AccessJwk } from '$lib/server/access-jwt';
import type { Database, DatabaseStatement } from '$lib/server/db';
import { adminAuthMode, adminAuthorizationContext, authorizeAdmin } from '$lib/server/admin-auth';

function databaseWithUser(user: unknown): Database {
	return {
		prepare() {
			const statement: DatabaseStatement = {
				bind() {
					return statement;
				},
				async all<T>() {
					return { results: user ? [user as T] : [] };
				}
			};
			return statement;
		}
	};
}

type TestKey = { privateKey: CryptoKey; jwk: AccessJwk; kid: string };

async function generateTestKey(kid: string): Promise<TestKey> {
	const pair = await crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: 'SHA-256'
		},
		true,
		['sign', 'verify']
	);
	const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as AccessJwk;
	return { privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' }, kid };
}

async function signAccessJwt(key: TestKey, team: string, email = 'admin@example.com') {
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const now = Math.floor(Date.now() / 1000);
	const data = `${encode({ alg: 'RS256', kid: key.kid })}.${encode({
		email,
		iss: `https://${team}`,
		aud: 'navinest-access',
		exp: now + 300
	})}`;
	const signature = await crypto.subtle.sign(
		{ name: 'RSASSA-PKCS1-v1_5' },
		key.privateKey,
		new TextEncoder().encode(data)
	);
	return `${data}.${Buffer.from(signature).toString('base64url')}`;
}

function jwksFetcher(key: TestKey): typeof fetch {
	return (async () =>
		new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 })) as unknown as typeof fetch;
}

describe('administrator authorization', () => {
	it('defaults to Access unless session mode is explicitly configured', () => {
		expect(adminAuthMode('session')).toBe('session');
		for (const value of [undefined, '', 'access', 'none', 'disabled'])
			expect(adminAuthMode(value)).toBe('access');
	});
	it('limits local preview to loopback requests without a Cloudflare platform', () => {
		for (const host of ['localhost', '127.0.0.1', '[::1]']) {
			const event = {
				url: new URL('http://' + host + '/admin'),
				request: new Request('http://' + host + '/admin'),
				locals: { user: null }
			};
			expect(adminAuthorizationContext(event as never).isLocal).toBe(true);
			expect(adminAuthorizationContext({ ...event, platform: { env: {} } } as never).isLocal).toBe(
				false
			);
		}
		expect(
			adminAuthorizationContext({
				url: new URL('https://nss.whks.de/admin'),
				request: new Request('https://nss.whks.de/admin'),
				locals: { user: null }
			} as never).isLocal
		).toBe(false);
	});
	it('carries Access verification settings from the platform env', () => {
		const context = adminAuthorizationContext({
			url: new URL('https://nss.whks.de/admin'),
			request: new Request('https://nss.whks.de/admin'),
			locals: { user: null },
			platform: {
				env: { CF_ACCESS_TEAM_DOMAIN: 'team.example.com', CF_ACCESS_AUD: 'aud-1' }
			}
		} as never);

		expect(context.accessTeamDomain).toBe('team.example.com');
		expect(context.accessAud).toBe('aud-1');
		expect(context.assertion).toBeNull();
	});
	it('does not trust a session identity without the deployed database binding', async () => {
		expect(
			await authorizeAdmin({
				database: null,
				isLocal: false,
				assertion: null,
				mode: 'session',
				user: { id: 7, email: null, username: 'owner', displayName: '管理员', role: 'admin' }
			})
		).toMatchObject({ authorized: false, status: 503 });
	});
	it('allows the explicit loopback development context', async () => {
		const result = await authorizeAdmin({
			database: null,
			isLocal: true,
			assertion: null
		});

		expect(result).toMatchObject({ authorized: true, identity: { source: 'local' } });
	});

	it('requires the Cloudflare Access assertion header', async () => {
		const result = await authorizeAdmin({
			database: databaseWithUser(null),
			isLocal: false,
			assertion: null,
			accessTeamDomain: 'team.example.com'
		});

		expect(result).toEqual({
			authorized: false,
			status: 401,
			message: 'Cloudflare Access authentication required.'
		});
	});

	it('fails closed when Access JWT verification is not configured', async () => {
		const result = await authorizeAdmin({
			database: databaseWithUser(null),
			isLocal: false,
			assertion: 'signed-access-token'
		});

		expect(result).toMatchObject({ authorized: false, status: 503 });
	});

	it('rejects assertions that fail signature verification', async () => {
		const result = await authorizeAdmin({
			database: databaseWithUser(null),
			isLocal: false,
			assertion: 'not.a.jwt',
			accessTeamDomain: 'team.example.com'
		});

		expect(result).toMatchObject({ authorized: false, status: 401 });
	});

	it('allows only verified Access tokens for active D1 users with the admin role', async () => {
		const key = await generateTestKey('kid-admin-auth');
		const team = 'team-admin-auth.example.com';
		const token = await signAccessJwt(key, team);
		const context = {
			isLocal: false,
			assertion: token,
			accessTeamDomain: team,
			accessAud: 'navinest-access',
			accessFetch: jwksFetcher(key)
		};
		const allowed = await authorizeAdmin({
			...context,
			database: databaseWithUser({
				id: 7,
				email: 'admin@example.com',
				display_name: 'Admin',
				role: 'admin',
				status: 'active'
			})
		});
		const denied = await authorizeAdmin({
			...context,
			database: databaseWithUser({
				id: 8,
				email: 'admin@example.com',
				display_name: 'Member',
				role: 'user',
				status: 'active'
			})
		});

		expect(allowed).toMatchObject({
			authorized: true,
			identity: { id: 7, email: 'admin@example.com', source: 'access' }
		});
		expect(denied).toMatchObject({ authorized: false, status: 403 });
	});

	it('fails closed when the deployed database binding is unavailable', async () => {
		const key = await generateTestKey('kid-db');
		const result = await authorizeAdmin({
			database: null,
			isLocal: false,
			assertion: await signAccessJwt(key, 'team-db.example.com'),
			accessTeamDomain: 'team-db.example.com',
			accessFetch: jwksFetcher(key)
		});

		expect(result).toMatchObject({ authorized: false, status: 503 });
	});
});
