import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { securityHeaders, shouldPrivateNoStore } from '$lib/server/security-headers';
describe('browser security policy', () => {
	it('defines a restrictive shared browser policy', () => {
		expect(securityHeaders).toMatchObject({
			'x-content-type-options': 'nosniff',
			'x-frame-options': 'DENY',
			'referrer-policy': 'strict-origin-when-cross-origin',
			'strict-transport-security': 'max-age=31536000; includeSubDomains',
			'cross-origin-opener-policy': 'same-origin'
		});
		expect(securityHeaders['permissions-policy']).toContain('camera=()');
		expect(securityHeaders['content-security-policy']).toContain("frame-ancestors 'none'");
		expect(securityHeaders['content-security-policy']).toContain("object-src 'none'");
	});
	it('marks every identity-aware route private and uncached', () => {
		for (const path of [
			'/login',
			'/user',
			'/user/messages',
			'/contribute',
			'/admin',
			'/api/auth/github',
			'/api/user/profile',
			'/api/admin/files'
		])
			expect(shouldPrivateNoStore(path)).toBe(true);
		for (const path of ['/', '/sites/vite', '/api/content-files/5', '/robots.txt'])
			expect(shouldPrivateNoStore(path)).toBe(false);
	});
	it('applies the shared policy from the global server hook', () => {
		const hook = readFileSync('src/hooks.server.ts', 'utf8');
		expect(hook).toContain('securityHeaders');
		expect(hook).toContain('shouldPrivateNoStore');
		expect(hook).toContain("response.headers.set('cache-control', 'private, no-store')");
	});
});
