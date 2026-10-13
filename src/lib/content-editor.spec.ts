import { describe, expect, it } from 'vitest';
import { suggestedContentSlug } from './content-editor';
import { itemFormInput } from './server/admin-mutations';
describe('content address generation', () => {
	it('supports Chinese titles and distinct addresses', () => {
		expect(suggestedContentSlug('中文文章', '', 'abc123')).toBe('content-abc123');
		expect(suggestedContentSlug('中文网站', 'https://www.example.com/path', 'abc123')).toBe(
			'example-com-abc123'
		);
		expect(suggestedContentSlug('A'.repeat(160), '', 'xyz789')).toMatch(/^[a-z0-9-]{1,100}$/);
	});
	it('generates missing form addresses while preserving existing addresses', () => {
		const data = new FormData();
		data.set('title', '中文文章');
		expect(itemFormInput(data).slug).toMatch(/^content-[a-f0-9]{12}$/);
		expect(itemFormInput(data).slug).not.toBe(itemFormInput(data).slug);
		data.set('slug', 'existing-address');
		expect(itemFormInput(data).slug).toBe('existing-address');
	});
});
