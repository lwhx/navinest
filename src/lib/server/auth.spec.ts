import { describe, expect, it } from 'vitest';
import {
	createPasswordHash,
	createSessionToken,
	hashSessionToken,
	normalizeLoginIdentifier,
	verifyPasswordHash
} from '$lib/server/auth';

describe('password authentication primitives', () => {
	it('hashes and verifies passwords without storing plaintext', async () => {
		const hash = await createPasswordHash('Correct horse battery staple', {
			salt: Uint8Array.from({ length: 16 }, (_, index) => index),
			iterations: 10
		});

		expect(hash).toMatch(/^pbkdf2-sha256\$10\$/);
		expect(hash).not.toContain('Correct horse battery staple');
		expect(await verifyPasswordHash('Correct horse battery staple', hash)).toBe(true);
		expect(await verifyPasswordHash('wrong password', hash)).toBe(false);
	});

	it('rejects malformed password hashes', async () => {
		expect(await verifyPasswordHash('anything', 'invalid')).toBe(false);
		expect(await verifyPasswordHash('anything', 'pbkdf2-sha256$0$bad$bad')).toBe(false);
	});

	it('verifies a fixed production-strength PBKDF2 vector', async () => {
		const hash =
			'pbkdf2-sha256$210000$AAECAwQFBgcICQoLDA0ODw$yj4RlpLO69ajiGCApCa3K43oekkvCz7kBUQbXMdNdiI';
		expect(await verifyPasswordHash('Acceptance-Password-2026!', hash)).toBe(true);
	});

	it('creates a Workers-compatible segmented production hash', async () => {
		const hash = await createPasswordHash('worker-safe-password', {
			salt: Uint8Array.from({ length: 16 }, (_, index) => index)
		});
		expect(hash).toMatch(/^pbkdf2-sha256-segmented\$70000\$3\$/);
		expect(await verifyPasswordHash('worker-safe-password', hash)).toBe(true);
	});
});

describe('session primitives', () => {
	it('creates opaque tokens and deterministic database digests', async () => {
		const token = createSessionToken(Uint8Array.from({ length: 32 }, (_, index) => index));
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(token.length).toBeGreaterThan(40);
		expect(await hashSessionToken(token)).toBe(await hashSessionToken(token));
		expect(await hashSessionToken(token)).not.toBe(token);
	});

	it('normalizes login identifiers consistently', () => {
		expect(normalizeLoginIdentifier(' User@Example.COM ')).toBe('user@example.com');
		expect(normalizeLoginIdentifier(' Alice ')).toBe('alice');
	});
});
