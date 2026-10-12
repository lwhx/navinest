import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(path, 'utf8');
describe('administrator productization', () => {
	it('provides responsive shared administration navigation', () => {
		const layout = read('src/routes/admin/+layout.svelte');
		expect(layout).toContain('admin-menu-button');
		expect(layout).toContain('admin-mobile-backdrop');
		expect(layout).toContain('id="admin-main"');
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
		expect(page).toContain('<CategoryParentPicker');
		expect(node).toContain('node.deleteImpact');
		expect(node).toContain('disabled={!node.canDelete}');
		expect(css).toContain('.category-workbench');
		expect(css).toContain('@media (max-width: 900px)');
	});
	it('provides a filtered high-density content workbench', () => {
		const page = read('src/routes/admin/items/+page.svelte'),
			row = read('src/lib/components/admin/AdminContentRow.svelte'),
			form = read('src/lib/components/admin/AdminItemForm.svelte'),
			css = read('src/routes/admin-content-workbench.css');
		for (const marker of [
			'content-type-tabs',
			'content-search',
			'content-category-filter',
			'content-status-filter',
			'content-visibility-filter',
			'filteredItems',
			'content-workbench'
		])
			expect(page).toContain(marker);
		expect(page).toContain('<AdminContentRow');
		expect(row).toContain('前台预览');
		expect(row).toContain('删除后会清理关联标签、元数据、收藏、足迹和统计记录');
		expect(form).toContain('initialType');
		expect(form).toContain('initialCategoryId');
		expect(css).toContain('.content-workbench');
		expect(page).toContain('sortableScope');
		expect(page).toContain("fetch('/api/admin/items/order'");
		expect(page).toContain('orderedItems = previous');
		expect(page).toContain('sortingMode');
		expect(page).toContain('进入排序');
		expect(page).toContain('content-editor-modal');
		expect(page).toContain('role="dialog"');
		expect(page).toContain('editingItem');
		expect(page).toContain('data.editing');
		expect(page).toContain('{form}');
		expect(page).toContain('editorTrigger');
		expect(page).toContain('focusFirstEditorControl');
		expect(page).toContain('trapEditorFocus');
		expect(page).toContain('content-command-bar');
		expect(page).toContain('content-table-head');
		expect(page).toContain('selectedItemIds');
		expect(page).toContain('content-density-toggle');
		expect(page).toContain('content-selection-bar');
		expect(row).toContain('content-row-select');
		expect(row).toContain('content-row-menu');
		expect(form).toContain('editor-section-nav');
		expect(form).toContain('基础信息');
		expect(form).toContain('内容与描述');
		expect(form).toContain('媒体资源');
		expect(form).toContain('发布设置');
		expect(row).toContain('onEdit');
		expect(row).not.toContain('href={resolve(`/admin/items?edit=');
		expect(row).toContain('content-drag-handle');
		expect(row).toContain('上移');
		expect(row).toContain('下移');
	});
});
