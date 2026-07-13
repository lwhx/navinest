import { error } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import { categoryContent, categoryFallback } from '$lib/server/services/content-pages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
	const database = getDatabase(platform);
	let data;

	if (!database) {
		data = categoryFallback(params.slug);
	} else {
		try {
			data = await categoryContent(database, params.slug);
		} catch (cause) {
			console.error('Failed to load category from D1; using fallback data.', cause);
			data = categoryFallback(params.slug);
		}
	}

	if (!data) error(404, 'Category not found');
	return { ...data, slug: params.slug };
};
