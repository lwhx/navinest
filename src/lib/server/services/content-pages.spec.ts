import { describe, expect, it } from 'vitest';
import { categoryFallback, searchFallback, tagFallback } from '$lib/server/services/content-pages';
import { fallbackHomeData } from '$lib/server/services/home';
import { fallbackContentDetail } from '$lib/server/services/content-detail';

describe('navigation fallback data', () => {
	it('groups homepage items under their configured categories', () => {
		const data = fallbackHomeData();
		const development = data.sections.find((section) => section.slug === 'dev-tools');

		expect(data.sections).toHaveLength(data.categories.length);
		expect(development?.items.map((item) => item.title)).toEqual(['GitHub', 'Svelte']);
	});

	it('searches fallback titles, summaries, categories and tags', () => {
		const data = searchFallback('prototype');

		expect(data.items.map((item) => item.title)).toEqual(['Figma']);
		expect(data.description).toContain('1');
	});

	it('returns fallback category and tag listings', () => {
		const category = categoryFallback('dev-tools');
		const tag = tagFallback('design');

		expect(category?.items).toHaveLength(2);
		expect(tag?.items.map((item) => item.title)).toEqual([
			'Figma',
			'The Design of Everyday Things'
		]);
	});

	it('builds typed fallback detail data with tag slugs', () => {
		const detail = fallbackContentDetail('book', 'design-of-everyday-things');

		expect(detail).toMatchObject({
			type: 'book',
			category: { slug: 'bookshelf' },
			tags: [
				{ name: 'Reading', slug: 'reading' },
				{ name: 'Design', slug: 'design' }
			]
		});
	});
});
