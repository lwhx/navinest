import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(path, 'utf8');
describe('administrator productization', () => {
	it('provides responsive shared administration navigation', () => {
		const layout = read('src/routes/admin/+layout.svelte');
		expect(layout).toContain('admin-menu-button');
		expect(layout).toContain('admin-mobile-backdrop');
		expect(layout).toContain('id="main-content"');
		expect(layout).toContain('aria-current');
	});
	it('shows protected previews and content references before deletion', () => {
		const page = read('src/routes/admin/files/+page.svelte');
		expect(page).toContain('/api/admin/files/[id]');
		expect(page).toContain('file.references');
		expect(page).toContain("reference.usage === 'icon'");
		expect(page).toContain('file.references.length === 0');
	});
});
