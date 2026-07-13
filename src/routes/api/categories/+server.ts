import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import { requireDatabase } from '$lib/server/db';
import { listCategories } from '$lib/server/services/categories';
import type { ContentType } from '$lib/types/content';
import type { RequestHandler } from './$types';

const contentTypes = new Set<ContentType>(['site', 'post', 'app', 'book', 'bulletin']);

export const GET: RequestHandler = async ({ platform, url }) => {
	try {
		const requestedType = url.searchParams.get('type');
		const type =
			requestedType && contentTypes.has(requestedType as ContentType)
				? (requestedType as ContentType)
				: undefined;
		const categories = await listCategories(requireDatabase(platform), { type });

		return json({ data: categories });
	} catch (error) {
		return apiError(error);
	}
};
