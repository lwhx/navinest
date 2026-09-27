import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicRoutes, protectedRoutes } from '../../scripts/production-smoke-config.mjs';
describe('production smoke specification', () => {
	it('covers the public product surface and all five detail types', () => {
		const paths = publicRoutes.map((route) => route.path);
		for (const path of [
			'/',
			'/search?q=Vite',
			'/categories/dev-tools',
			'/categories/frontend-dev',
			'/tags/dev',
			'/sites/vite',
			'/posts/building-a-quiet-start-space',
			'/apps/notion',
			'/books/design-of-everyday-things',
			'/bulletins/navinest-preview',
			'/rankings',
			'/hotnews',
			'/login'
		])
			expect(paths).toContain(path);
		expect(new Set(publicRoutes.map((route) => route.name)).size).toBe(publicRoutes.length);
	});
	it('keeps protected checks anonymous and read only', () => {
		expect(protectedRoutes).toEqual([
			{ path: '/user', expected: [302, 303] },
			{ path: '/user/settings', expected: [302, 303] },
			{ path: '/admin', expected: [301, 302, 303, 401, 403] }
		]);
		const script = readFileSync('scripts/production-smoke.mjs', 'utf8');
		expect(script).toContain('sanitizeLocation');
		expect(script).not.toContain("location: response.headers.get('location')");
		expect(script).not.toMatch(/cf-access-client|authorization|cookie/i);
		expect(script).not.toMatch(/method:\s*['"](?:POST|PUT|PATCH|DELETE)/i);
	});
	it('exposes a one-command package script', () => {
		const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
		expect(pkg.scripts['smoke:production']).toBe('node scripts/production-smoke.mjs');
		expect(pkg.devDependencies.playwright).toBeTruthy();
	});
});
