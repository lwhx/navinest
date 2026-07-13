import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('productized public pages', () => {
	it('uses the shared public shell for listings', () => {
		for (const file of [
			'src/routes/categories/[slug]/+page.svelte',
			'src/routes/search/+page.svelte',
			'src/routes/tags/[slug]/+page.svelte'
		]) {
			const page = readFileSync(file, 'utf8');
			expect(page).toContain('PublicShell');
			expect(page).toContain('listing-hero');
		}
	});
	it('renders differentiated detail variants inside the shared shell', () => {
		const detail = readFileSync('src/lib/components/ContentDetail.svelte', 'utf8');
		expect(detail).toContain('PublicShell');
		for (const kind of [
			'detail-site',
			'detail-post',
			'detail-app',
			'detail-book',
			'detail-bulletin'
		])
			expect(detail).toContain(kind);
	});
});
