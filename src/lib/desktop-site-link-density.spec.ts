import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/routes/home-reference.css', 'utf8');

describe('desktop home site link density', () => {
	it('sizes cards from their content container instead of forcing six narrow columns', () => {
		expect(css).toMatch(
			/\.site-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*170px\),\s*1fr\)\)/s
		);
		expect(css).not.toMatch(/\.site-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6,/s);
		expect(css).toMatch(/\.site-grid\s*\{[^}]*container-type:\s*inline-size/s);
		expect(css).toMatch(/\.site-grid\s*\{[^}]*gap:\s*10px/s);
		expect(css).toMatch(/\.site-grid \.card-site:not\(\.compact\)[^{]*\{[^}]*min-height:\s*64px/s);
		expect(css).toMatch(
			/\.site-grid \.card-site:not\(\.compact\) \.site-icon[^{]*\{[^}]*width:\s*36px/s
		);
	});
});
