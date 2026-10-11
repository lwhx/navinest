import { describe, expect, it } from 'vitest';
import { buildHomeCategoryLinks, activeHomeCategory } from './home-category-navigation';

describe('homepage category navigation', () => {
	it('uses the rendered module order and heading rather than taxonomy order', () => {
		expect(
			buildHomeCategoryLinks(
				[
					{ type: 'ranking', title: '排行榜' },
					{ type: 'content', categorySlug: 'dev', title: '开发入口' },
					{ type: 'content', categorySlug: 'ai', title: 'AI' },
					{ type: 'content', categorySlug: 'missing', title: '已删除分类' }
				],
				[{ slug: 'ai' }, { slug: 'dev' }]
			)
		).toEqual([
			{ slug: 'dev', name: '开发入口' },
			{ slug: 'ai', name: 'AI' }
		]);
	});
	it('keeps a sparse category active until the next heading reaches the anchor line', () => {
		expect(
			activeHomeCategory(
				[
					{ id: 'books', top: 104 },
					{ id: 'notes', top: 299 }
				],
				104
			)
		).toBe('books');
		expect(
			activeHomeCategory(
				[
					{ id: 'books', top: -91 },
					{ id: 'notes', top: 104 }
				],
				104
			)
		).toBe('notes');
	});
	it('keeps a tall section active while its heading is above the viewport', () => {
		expect(
			activeHomeCategory(
				[
					{ id: 'dev', top: -400 },
					{ id: 'ai', top: 700 }
				],
				104
			)
		).toBe('dev');
	});
	it('handles the hero, the last section and an empty page', () => {
		expect(activeHomeCategory([{ id: 'first', top: 600 }], 104)).toBe('first');
		expect(
			activeHomeCategory(
				[
					{ id: 'first', top: -500 },
					{ id: 'last', top: -20 }
				],
				104
			)
		).toBe('last');
		expect(activeHomeCategory([], 104)).toBe('');
	});
});
