import { describe, expect, it } from 'vitest';
import { homeSubcategoryUrl, readHomeSubcategories } from './home-subcategory-state';

const sections = [
	{ slug: 'tools', children: [{ slug: 'frontend' }, { slug: 'all' }] },
	{ slug: 'design', children: [{ slug: 'frontend' }] }
];
describe('homepage subcategory URLs', () => {
	it('restores independent selections scoped to the rendered parent', () => {
		expect(
			readHomeSubcategories(
				new URL('https://example.com/?sub.tools=frontend&sub.design=frontend'),
				sections
			)
		).toEqual({ tools: 'frontend', design: 'frontend' });
	});
	it('ignores deleted, hidden, wrong-parent and repeated selections', () => {
		for (const query of [
			'sub.tools=missing',
			'sub.missing=frontend',
			'sub.design=all',
			'sub.tools=frontend&sub.tools=all'
		])
			expect(readHomeSubcategories(new URL('https://example.com/?' + query), sections)).toEqual({});
	});
	it('does not reserve the actual child slug all for the all-items selection', () => {
		expect(readHomeSubcategories(new URL('https://example.com/?sub.tools=all'), sections)).toEqual({
			tools: 'all'
		});
		expect(homeSubcategoryUrl(new URL('https://example.com/?sub.tools=all'), 'tools', null)).toBe(
			'#tools'
		);
	});
	it('preserves other selections, unrelated parameters without duplicating the base path or mutating its input', () => {
		const input = new URL('https://example.com/base/?source=share&sub.design=frontend#design');
		expect(homeSubcategoryUrl(input, 'tools', 'frontend')).toBe(
			'?source=share&sub.design=frontend&sub.tools=frontend#tools'
		);
		expect(input.href).toBe('https://example.com/base/?source=share&sub.design=frontend#design');
		expect(
			homeSubcategoryUrl(
				new URL('https://example.com/?sub.tools=frontend&sub.design=frontend'),
				'tools',
				null
			)
		).toBe('?sub.design=frontend#tools');
	});
	it('encodes punctuation and Unicode rather than interpreting them as URL syntax', () => {
		const section = { slug: '工具 & a#', children: [{ slug: '前端 / x?&' }] };
		const url = new URL(
			homeSubcategoryUrl(new URL('https://example.com/'), section.slug, section.children[0].slug),
			'https://example.com'
		);
		expect(readHomeSubcategories(url, [section])).toEqual({
			[section.slug]: section.children[0].slug
		});
	});
	it('treats prototype-like names as ordinary own keys', () => {
		const state = readHomeSubcategories(new URL('https://example.com/?sub.__proto__=constructor'), [
			{ slug: '__proto__', children: [{ slug: 'constructor' }] }
		]);
		expect(Object.keys(state)).toEqual(['__proto__']);
		expect(Object.getPrototypeOf(state)).toBe(null);
		expect(state.constructor).toBeUndefined();
	});
});
