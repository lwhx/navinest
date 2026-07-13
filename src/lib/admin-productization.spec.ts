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
	it('provides a searchable hierarchical category workbench', () => {
		const page = read('src/routes/admin/categories/+page.svelte'),
			node = read('src/lib/components/CategoryTreeNode.svelte'),
			css = read('src/routes/admin-productization.css');
		for (const marker of [
			'category-workbench',
			'category-search',
			'category-type-filter',
			'category-visibility-filter',
			'filteredRoots',
			'workbench.summary'
		])
			expect(page).toContain(marker);
		expect(page).toContain('<CategoryTreeNode');
		expect(node).toContain('node.children');
		expect(node).toContain('快速新增子分类');
		expect(page).toContain('data.createParent?.type');
		expect(page).toContain('selected={');
		expect(node).toContain('node.deleteImpact');
		expect(node).toContain('disabled={!node.canDelete}');
		expect(css).toContain('.category-workbench');
		expect(css).toContain('@media (max-width: 900px)');
	});
});
