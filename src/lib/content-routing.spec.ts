import { describe, expect, it } from 'vitest';
import { contentDetailRoute } from '$lib/content-routing';
import type { ContentType } from '$lib/types/content';

describe('content detail routing', () => {
	it.each<[ContentType, string]>([
		['site', '/sites/[slug]'],
		['post', '/posts/[slug]'],
		['app', '/apps/[slug]'],
		['book', '/books/[slug]'],
		['bulletin', '/bulletins/[slug]']
	])('maps %s to its own detail route', (type, expected) => {
		expect(contentDetailRoute(type)).toBe(expected);
	});
});
