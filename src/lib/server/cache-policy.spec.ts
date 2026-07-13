import { describe, expect, it } from 'vitest';
import { cacheControlFor } from '$lib/server/cache-policy';

describe('cache policy', () => {
	it('never publicly caches identity-aware homepage HTML', () => {
		expect(cacheControlFor('identity-page')).toBe('private, no-store');
	});
	it('uses bounded shared caching for public rankings', () => {
		expect(cacheControlFor('rankings')).toBe(
			'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
		);
	});
	it('keeps refresh-sensitive hot news uncached', () => {
		expect(cacheControlFor('realtime')).toBe('no-store');
	});
});
