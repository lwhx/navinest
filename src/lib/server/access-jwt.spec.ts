import { describe, expect, it } from 'vitest';
import {
	normalizeAccessTeamDomain,
	verifyAccessAssertion,
	type AccessJwk
} from '$lib/server/access-jwt';

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

function encodeSegment(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function signAccessJwt(
	key: TestKey,
	claims: {
		team: string;
		email?: string;
		aud?: string | string[];
		issuedAtSeconds?: number;
		lifetimeSeconds?: number;
		kid?: string;
		alg?: string;
	}
): Promise<string> {
	const issuedAt = claims.issuedAtSeconds ?? Math.floor(Date.now() / 1000);
	const header = { alg: claims.alg ?? 'RS256', kid: claims.kid ?? key.kid };
	const payload = {
		email: claims.email ?? 'admin@example.com',
		iss: `https://${claims.team}`,
		aud: claims.aud ?? 'navinest-access',
		iat: issuedAt,
		exp: issuedAt + (claims.lifetimeSeconds ?? 300)
	};
	const data = `${encodeSegment(header)}.${encodeSegment(payload)}`;
	const signature = await crypto.subtle.sign(
		{ name: 'RSASSA-PKCS1-v1_5' },
		key.privateKey,
		new TextEncoder().encode(data)
	);
	return `${data}.${Buffer.from(signature).toString('base64url')}`;
}

function jwksFetcher(key: TestKey): typeof fetch {
	return (async () =>
		new Response(JSON.stringify({ keys: [key.jwk] }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		})) as unknown as typeof fetch;
}

describe('Cloudflare Access assertion verification', () => {
	it('accepts a properly signed token and returns the verified email', async () => {
		const key = await generateTestKey('kid-1');
		const token = await signAccessJwt(key, { team: 'team-accept.example.com' });
		const result = await verifyAccessAssertion(token, {
			teamDomain: 'team-accept.example.com',
			aud: 'navinest-access',
			fetcher: jwksFetcher(key)
		});

		expect(result).toEqual({ ok: true, email: 'admin@example.com' });
	});

	it('normalizes the team domain with scheme and trailing slashes', async () => {
		const key = await generateTestKey('kid-normalize');
		const token = await signAccessJwt(key, { team: 'team-normalize.example.com' });
		const result = await verifyAccessAssertion(token, {
			teamDomain: 'https://team-normalize.example.com/',
			fetcher: jwksFetcher(key)
		});

		expect(result).toEqual({ ok: true, email: 'admin@example.com' });
	});

	it('rejects tokens that are not three RS256 segments with a kid', async () => {
		const key = await generateTestKey('kid-shape');
		const team = 'team-shape.example.com';
		const token = await signAccessJwt(key, { team });
		const unsigned = token.replace(/\.([^.]*)$/, '');
		const hs256 = `${encodeSegment({ alg: 'HS256', kid: key.kid })}.${token.split('.')[1]}.c2ln`;
		for (const assertion of ['', 'a.b', hs256, unsigned]) {
			const result = await verifyAccessAssertion(assertion, {
				teamDomain: team,
				fetcher: jwksFetcher(key)
			});
			expect(result).toMatchObject({ ok: false });
		}
	});

	it('rejects expired tokens', async () => {
		const key = await generateTestKey('kid-expired');
		const token = await signAccessJwt(key, {
			team: 'team-expired.example.com',
			issuedAtSeconds: Math.floor(Date.now() / 1000) - 120,
			lifetimeSeconds: 30
		});
		const result = await verifyAccessAssertion(token, {
			teamDomain: 'team-expired.example.com',
			fetcher: jwksFetcher(key)
		});

		expect(result).toEqual({ ok: false, reason: 'expired' });
	});

	it('rejects tokens from another issuer', async () => {
		const key = await generateTestKey('kid-issuer');
		const token = await signAccessJwt(key, { team: 'other-team.example.com' });
		const result = await verifyAccessAssertion(token, {
			teamDomain: 'team-issuer.example.com',
			fetcher: jwksFetcher(key)
		});

		expect(result).toEqual({ ok: false, reason: 'issuer' });
	});

	it('rejects audience mismatches for string and array audiences', async () => {
		const key = await generateTestKey('kid-aud');
		const simple = await signAccessJwt(key, {
			team: 'team-aud.example.com',
			aud: 'different-app'
		});
		const listed = await signAccessJwt(key, {
			team: 'team-aud.example.com',
			aud: ['other-app', 'another-app']
		});
		for (const token of [simple, listed]) {
			expect(
				await verifyAccessAssertion(token, {
					teamDomain: 'team-aud.example.com',
					aud: 'navinest-access',
					fetcher: jwksFetcher(key)
				})
			).toEqual({ ok: false, reason: 'audience' });
		}
	});

	it('rejects signatures from an unknown key and tampered payloads', async () => {
		const known = await generateTestKey('kid-known');
		const stranger = await generateTestKey('kid-stranger');
		const foreign = await signAccessJwt(stranger, { team: 'team-sig.example.com' });
		expect(
			await verifyAccessAssertion(foreign, {
				teamDomain: 'team-sig.example.com',
				fetcher: jwksFetcher(known)
			})
		).toEqual({ ok: false, reason: 'signature' });

		const token = await signAccessJwt(known, { team: 'team-sig.example.com' });
		const [head, , tail] = token.split('.');
		const tampered = `${head}.${encodeSegment({
			email: 'intruder@example.com',
			iss: 'https://team-sig.example.com',
			aud: 'navinest-access',
			exp: Math.floor(Date.now() / 1000) + 300
		})}.${tail}`;
		expect(
			await verifyAccessAssertion(tampered, {
				teamDomain: 'team-sig.example.com',
				fetcher: jwksFetcher(known)
			})
		).toEqual({ ok: false, reason: 'signature' });
	});

	it('fails unavailable when the JWKS endpoint errors', async () => {
		const key = await generateTestKey('kid-unavailable');
		const token = await signAccessJwt(key, { team: 'team-unavailable.example.com' });
		const failing: typeof fetch = (async () =>
			new Response('boom', { status: 500 })) as unknown as typeof fetch;
		expect(
			await verifyAccessAssertion(token, {
				teamDomain: 'team-unavailable.example.com',
				fetcher: failing
			})
		).toEqual({ ok: false, reason: 'key-unavailable' });
	});

	it('rejects verified tokens without an email claim', async () => {
		const key = await generateTestKey('kid-email');
		const token = await signAccessJwt(key, { team: 'team-email.example.com', email: '' });
		expect(
			await verifyAccessAssertion(token, {
				teamDomain: 'team-email.example.com',
				fetcher: jwksFetcher(key)
			})
		).toEqual({ ok: false, reason: 'malformed' });
	});

	it('reuses the cached JWKS for the same origin', async () => {
		const key = await generateTestKey('kid-cache');
		const team = 'team-cache.example.com';
		let calls = 0;
		const counting: typeof fetch = (async (input: RequestInfo | URL) => {
			calls += 1;
			expect(String(input)).toBe(`https://${team}/cdn-cgi/access/certs`);
			return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
		}) as unknown as typeof fetch;
		const first = await verifyAccessAssertion(await signAccessJwt(key, { team }), {
			teamDomain: team,
			fetcher: counting
		});
		const second = await verifyAccessAssertion(await signAccessJwt(key, { team }), {
			teamDomain: team,
			fetcher: counting
		});

		expect(first).toEqual({ ok: true, email: 'admin@example.com' });
		expect(second).toEqual({ ok: true, email: 'admin@example.com' });
		expect(calls).toBe(1);
	});
});

describe('team domain normalization', () => {
	it('strips scheme, casing whitespace and trailing slashes', () => {
		expect(normalizeAccessTeamDomain('  https://Team.Example.com/  ')).toBe('Team.Example.com');
		expect(normalizeAccessTeamDomain('team.example.com')).toBe('team.example.com');
	});
});
