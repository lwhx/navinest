import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('global keyboard navigation', () => {
	it('provides a skip link to the main content target', () => {
		const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
		expect(layout).toContain('href="#main-content"');
		expect(layout).toContain('id="main-content"');
		expect(layout).toContain('class="skip-link"');
	});
	it('keeps every card title linked to its detail page when mobile actions are hidden', () => {
		const card = readFileSync('src/lib/components/NavigationCard.svelte', 'utf8');
		expect(card).toContain('class="card-title-link"');
		expect(card).toContain('href={detail}');
	});
});
