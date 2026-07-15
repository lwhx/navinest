import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicPage = readFileSync('src/routes/hotnews/+page.svelte', 'utf8'),
	adminPage = readFileSync('src/routes/admin/hot-sources/+page.svelte', 'utf8');

describe('custom RSS hot boards', () => {
	it('provides board navigation and a focused modern ranking panel', () => {
		expect(publicPage).toContain('hot-board-tabs');
		expect(publicPage).toContain('activeSlug');
		expect(publicPage).toContain('hot-board-rank');
		expect(publicPage).toContain('source.accentColor');
		expect(publicPage).toContain('active.showDescription');
	});
	it('exposes RSSHub board branding, layout, limits and order in admin', () => {
		for (const field of [
			'name="slug"',
			'name="description"',
			'name="icon"',
			'name="accentColor"',
			'name="surfaceColor"',
			'name="displayLimit"',
			'name="layout"',
			'name="sortOrder"',
			'name="showDescription"'
		])
			expect(adminPage).toContain(field);
		expect(adminPage).toContain('RSSHub / RSS / Atom');
		expect(adminPage).toContain('hot-board-admin-grid');
	});
});
