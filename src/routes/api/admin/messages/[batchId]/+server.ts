import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { mutationApiError } from '$lib/server/admin-mutations';
import { withdrawMessageBatch } from '$lib/server/services/admin-messages';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ platform, params }) => {
	try {
		const removed = await withdrawMessageBatch(requireDatabase(platform), params.batchId);
		return json({ removed });
	} catch (error) {
		return mutationApiError(error);
	}
};
