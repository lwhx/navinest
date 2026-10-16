import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('administrator item media form', () => {
	it('keeps existing category and tag options during initial SSR state', () => {
		const form = readFileSync('src/lib/components/admin/AdminItemForm.svelte', 'utf8');
		expect(form).toContain('CategoryParentPicker');
		expect(form).toContain('bind:value={selectedCategory}');
		expect(form).toContain('untrack');
		expect(form).toContain('!selectedType || tag.type === selectedType');
	});
	it('offers icon and cover fields loaded from protected media API', () => {
		const form = readFileSync('src/lib/components/admin/AdminItemForm.svelte', 'utf8');
		expect(form).toContain('name="iconFileId"');
		expect(form).toContain('name="coverFileId"');
		const browser = readFileSync('src/lib/components/admin/MediaBrowser.svelte', 'utf8');
		expect(browser).toContain('/api/admin/files?');
		expect(form).toContain('<MediaPicker');
	});
});
