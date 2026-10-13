import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const phaseCss = readFileSync('src/routes/benchmark-home-phase4.css', 'utf8'),
	referenceCss = readFileSync('src/routes/home-reference.css', 'utf8');

describe('home taxonomy and link density', () => {
	it('gives second-level category buttons a clear touch target', () => {
		expect(referenceCss).toMatch(/\.subcategory-tabs a\s*\{[^}]*min-height:\s*36px/s);
		expect(referenceCss).toMatch(/\.subcategory-tabs a\s*\{[^}]*padding:\s*8px 14px/s);
		expect(referenceCss).toMatch(/\.subcategory-tabs a\s*\{[^}]*font-size:\s*12px/s);
		expect(referenceCss).toMatch(
			/@media \(max-width: 620px\)[\s\S]*\.subcategory-tabs\s*\{[^}]*max-width:\s*min\(240px, calc\(100vw - 140px\)\)/s
		);
	});

	it('uses a six-column compact link grid on desktop with responsive fallbacks', () => {
		expect(phaseCss).toMatch(/\.home-links-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6,/s);
		expect(phaseCss).toMatch(/\.home-links-grid a\s*\{[^}]*padding:\s*9px 12px/s);
		expect(phaseCss).toMatch(
			/@media \(max-width: 1100px\)[\s\S]*\.home-links-grid\s*\{[^}]*repeat\(3,/s
		);
		expect(phaseCss).toMatch(
			/@media \(max-width: 620px\)[\s\S]*\.home-links-grid\s*\{[^}]*repeat\(2,/s
		);
	});
});
