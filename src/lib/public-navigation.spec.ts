import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public navigation completion', () => {
	it('renders a full footer and mobile tabbar from the shared shell', () => {
		const shell = readFileSync('src/lib/components/PublicShell.svelte', 'utf8');
		expect(shell).toContain('public-footer-grid');
		expect(shell).toContain('mobile-tabbar');
		expect(shell).toContain('友情链接');
	});
	it('uses the shared public shell for rankings and hotnews', () => {
		for (const file of ['src/routes/rankings/+page.svelte', 'src/routes/hotnews/+page.svelte']) {
			const page = readFileSync(file, 'utf8');
			expect(page).toContain('PublicShell');
			expect(page).toContain('listing-hero');
		}
	});
});
