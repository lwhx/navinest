import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('administrator item media form', () => {
	it('keeps existing category and tag options during initial SSR state', () => {
		const form = readFileSync('src/lib/components/admin/AdminItemForm.svelte', 'utf8');
		expect(form).toContain('!selectedType || category.type === selectedType');
		expect(form).toContain('bind:value={selectedCategory}');
		expect(form).toContain('value={String(category.id)}');
		expect(form).toContain('value={String(file.id)}');
		expect(form).toContain('!selectedType || tag.type === selectedType');
	});
	it('offers icon and cover fields loaded from protected media API', () => {
		const form = readFileSync('src/lib/components/admin/AdminItemForm.svelte', 'utf8');
		expect(form).toContain('name="iconFileId"');
		expect(form).toContain('name="coverFileId"');
		expect(form).toContain("resolve('/api/admin/files')");
	});
});
