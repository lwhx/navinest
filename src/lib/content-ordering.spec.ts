import { describe, expect, it } from 'vitest';
import { moveOrderedItem } from '$lib/content-ordering';
describe('content drag ordering', () => {
	it('moves one item before another without losing ids', () => {
		expect(moveOrderedItem([1, 2, 3, 4], 3, 1)).toEqual([3, 1, 2, 4]);
		expect(moveOrderedItem([1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
	});
	it('keeps the order for missing or identical ids', () => {
		expect(moveOrderedItem([1, 2, 3], 2, 2)).toEqual([1, 2, 3]);
		expect(moveOrderedItem([1, 2, 3], 9, 1)).toEqual([1, 2, 3]);
	});
});
