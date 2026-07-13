import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('global keyboard navigation', () => {
	it('provides a skip link to the main content target', () => {
		const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
		expect(layout).toContain('href="#main-content"');
		expect(layout).toContain('id="main-content"');
		expect(layout).toContain('class="skip-link"');
	});
});
