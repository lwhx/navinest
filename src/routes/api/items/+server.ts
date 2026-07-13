import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import { requireDatabase } from '$lib/server/db';
import { listItems } from '$lib/server/services/items';
import type { ContentType } from '$lib/types/content';
import type { RequestHandler } from './$types';

const contentTypes = new Set<ContentType>(['site', 'post', 'app', 'book', 'bulletin']);

function optionalInteger(value: string | null): number | undefined {
	if (value === null || value.trim() === '') return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export const GET: RequestHandler = async ({ platform, url }) => {
	try {
		const requestedType = url.searchParams.get('type');
		const type =
			requestedType && contentTypes.has(requestedType as ContentType)
				? (requestedType as ContentType)
				: undefined;
		const items = await listItems(requireDatabase(platform), {
			type,
			categorySlug: url.searchParams.get('category') || undefined,
			tagSlug: url.searchParams.get('tag') || undefined,
			search: url.searchParams.get('q') || undefined,
			limit: optionalInteger(url.searchParams.get('limit')),
			offset: optionalInteger(url.searchParams.get('offset'))
		});

		return json({ data: items, meta: { count: items.length } });
	} catch (error) {
		return apiError(error);
	}
};
