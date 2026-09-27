import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	contentSecurityPolicy,
	createCspNonce,
	requestSecurityHeaders,
	securityHeaders,
	shouldPrivateNoStore,
	withScriptNonce
} from '$lib/server/security-headers';
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
		expect(hook).toContain('createCspNonce');
		expect(hook).toContain('requestSecurityHeaders');
		expect(hook).toContain('transformPageChunk');
		expect(hook).toContain('shouldPrivateNoStore');
		expect(hook).toContain("response.headers.set('cache-control', 'private, no-store')");
	});
	it('issues a fresh nonce per request and drops inline script execution without it', () => {
		const first = createCspNonce(),
			second = createCspNonce();
		for (const nonce of [first, second]) expect(nonce).toMatch(/^[A-Za-z0-9_-]{20,32}$/);
		expect(first).not.toBe(second);
		const policy = contentSecurityPolicy(first);
		expect(policy).toContain(`script-src 'self' 'nonce-${first}'`);
		expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
		expect(policy).toContain("style-src 'self' 'unsafe-inline'");
		expect(policy).toContain("object-src 'none'");
		expect(securityHeaders['content-security-policy']).not.toContain(first);
	});
	it('hands the request policy to the hook without weakening the shared headers', () => {
		const nonce = createCspNonce(),
			headers = requestSecurityHeaders(nonce);
		expect(headers['content-security-policy']).toContain(`'nonce-${nonce}'`);
		expect(headers['strict-transport-security']).toBe(securityHeaders['strict-transport-security']);
		expect(headers['x-frame-options']).toBe('DENY');
		expect(requestSecurityHeaders(createCspNonce())['content-security-policy']).not.toBe(
			headers['content-security-policy']
		);
	});
	it('stamps the nonce on every script tag of a rendered document', () => {
		const nonce = createCspNonce();
		const html = `<script>document.documentElement.dataset.theme="dark";</script><script type="application/ld+json">{"@type":"WebSite"}</script><script src="/_app/immutable/entry/start.js"></script>`;
		const stamped = withScriptNonce(html, nonce);
		expect(stamped.match(new RegExp(`<script nonce="${nonce}"`, 'g'))).toHaveLength(3);
		expect(stamped).toContain(`<script nonce="${nonce}" type="application/ld+json">`);
		expect(stamped).not.toContain('<script>');
		expect(withScriptNonce(stamped, nonce)).toBe(stamped);
		expect(withScriptNonce(html, '')).toBe(html);
		expect(withScriptNonce('<p>no scripts here</p>', nonce)).toBe('<p>no scripts here</p>');
		expect(withScriptNonce('<script nonce="own">x</script>', nonce)).toBe(
			'<script nonce="own">x</script>'
		);
	});
	it('keeps the inline theme bootstrap in the document shell', () => {
		const shell = readFileSync('src/app.html', 'utf8');
		expect(shell).toContain('<script>');
		expect(shell).toContain('navinest-theme');
	});
});
