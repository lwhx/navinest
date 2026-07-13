import { error } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import { tagContent, tagFallback } from '$lib/server/services/content-pages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
	const database = getDatabase(platform);
	let data;

	if (!database) {
		data = tagFallback(params.slug);
	} else {
		try {
			data = await tagContent(database, params.slug);
		} catch (cause) {
			console.error('Failed to load tag from D1; using fallback data.', cause);
			data = tagFallback(params.slug);
		}
	}

	if (!data) error(404, 'Tag not found');
	return { ...data, slug: params.slug };
};
