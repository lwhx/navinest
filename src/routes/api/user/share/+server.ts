import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import {
	getShareSettings,
	saveShareSettings,
	SharePageError
} from '$lib/server/services/share-pages';
import type { RequestHandler } from './$types';

function failure(error: unknown) {
	if (error instanceof SharePageError)
		return json({ error: error.message, field: error.field ?? null }, { status: error.status });
	return json({ error: 'Invalid request' }, { status: 400 });
}

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	return json({ data: await getShareSettings(requireDatabase(platform), locals.user.id) });
};

export const PATCH: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const data = await saveShareSettings(requireDatabase(platform), locals.user.id, {
			slug: body.slug,
			enabled: body.enabled
		});
		return json({ data });
	} catch (error) {
		return failure(error);
	}
};
