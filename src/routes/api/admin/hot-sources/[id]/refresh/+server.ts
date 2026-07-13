import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { HotNewsError, refreshHotSource } from '$lib/server/services/hotnews';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ platform, params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0)
		return json({ error: 'Invalid source ID' }, { status: 400 });
	try {
		return json(await refreshHotSource(requireDatabase(platform), id));
	} catch (error) {
		if (error instanceof HotNewsError)
			return json({ error: error.message }, { status: error.status });
		return json({ error: 'Refresh failed' }, { status: 500 });
	}
};
