import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import { requireDatabase } from '$lib/server/db';
import { listSearchEngines } from '$lib/server/services/search-engines';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	try {
		const searchEngines = await listSearchEngines(requireDatabase(platform));
		return json({ data: searchEngines });
	} catch (error) {
		return apiError(error);
	}
};
