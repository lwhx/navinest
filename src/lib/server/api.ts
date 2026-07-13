import { json } from '@sveltejs/kit';
import { DatabaseUnavailableError } from '$lib/server/db';

export function apiError(error: unknown): Response {
	if (error instanceof DatabaseUnavailableError) {
		return json({ error: 'Database unavailable' }, { status: 503 });
	}

	console.error('API request failed', error);
	return json({ error: 'Internal server error' }, { status: 500 });
}
