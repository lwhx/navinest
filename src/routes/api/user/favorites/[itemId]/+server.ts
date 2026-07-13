import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { ActivityError, removeFavorite, setFavorite } from '$lib/server/services/user-activity';
import type { RequestHandler } from './$types';
function itemId(value: string) {
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : null;
}
export const PUT: RequestHandler = async ({ locals, platform, params }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	const id = itemId(params.itemId);
	if (!id) return json({ error: 'Invalid item ID' }, { status: 400 });
	try {
		await setFavorite(requireDatabase(platform), locals.user.id, id);
		return json({ favorite: true });
	} catch (error) {
		if (error instanceof ActivityError)
			return json({ error: error.message }, { status: error.status });
		throw error;
	}
};
export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	const id = itemId(params.itemId);
	if (!id) return json({ error: 'Invalid item ID' }, { status: 400 });
	await removeFavorite(requireDatabase(platform), locals.user.id, id);
	return json({ favorite: false });
};
