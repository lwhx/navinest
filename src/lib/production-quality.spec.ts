import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('production quality hardening', () => {
	it('gives content images stable lazy decoding dimensions', () => {
		const card = readFileSync('src/lib/components/NavigationCard.svelte', 'utf8');
		for (const value of ['loading="lazy"', 'decoding="async"', 'width="48"', 'height="48"'])
			expect(card).toContain(value);
	});
	it('uses long immutable caching for content-addressed media', () => {
		const route = readFileSync('src/routes/api/content-files/[id]/+server.ts', 'utf8');
		expect(route).toContain('max-age=31536000');
		expect(route).toContain('immutable');
	});
	it('honors reduced motion globally and raises critical text contrast', () => {
		const css = readFileSync('src/routes/quality-hardening.css', 'utf8');
		expect(css).toContain('@media (prefers-reduced-motion: reduce)');
		expect(css).toContain('animation-duration: 0.01ms');
		for (const selector of [
			'.hero-search-form button',
			'.site-content > p',
			'.tag-row a',
			'.detail-link',
			'.subcategory-tabs a'
		])
			expect(css).toContain(selector);
	});
	it('keeps 404 and machine-readable SEO routes in production smoke checks', () => {
		const script = readFileSync('scripts/production-smoke.mjs', 'utf8'),
			config = readFileSync('scripts/production-smoke-config.mjs', 'utf8');
		expect(config).toContain("path: '/__smoke_missing__'");
		expect(config).toContain("path: '/robots.txt'");
		expect(config).toContain("path: '/sitemap.xml'");
		expect(config).toContain('requiredHeaders');
		expect(config).toContain("'content-security-policy'");
		expect(script).toContain('route.requiredHeaders');
		expect(script).toContain('response.headers.get(name)');
		expect(script).toContain('expectedStatus');
	});
});
