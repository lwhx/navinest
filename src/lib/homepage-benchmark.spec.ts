import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('OneNav benchmark homepage', () => {
	it('contains the productized homepage regions', () => {
		const page =
			readFileSync('src/routes/+page.svelte', 'utf8') +
			readFileSync('src/lib/components/HomeModuleFlow.svelte', 'utf8');
		for (const region of [
			'home-header',
			'home-sidebar',
			'search-hero',
			'popular-sites',
			'category-sections'
		])
			expect(page).toContain(region);
	});
	it('uses differentiated content cards and a mobile menu', () => {
		const page = readFileSync('src/routes/+page.svelte', 'utf8');
		const card = readFileSync('src/lib/components/NavigationCard.svelte', 'utf8');
		expect(page).toContain('mobile-menu-button');
		expect(page).toContain('mobile-drawer');
		for (const kind of ['card-site', 'card-post', 'card-app', 'card-book', 'card-bulletin'])
			expect(card).toContain(kind);
	});
});
