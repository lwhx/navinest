import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { CustomNavigationError } from '$lib/server/services/custom-navigation';
import { importBookmarks, parseBookmarkHtml } from '$lib/server/services/bookmark-import';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	try {
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json({ error: 'Invalid request' }, { status: 400 });
		}
		const html = (body as Record<string, unknown> | null)?.html;
		const parsed = parseBookmarkHtml(html);
		const result = await importBookmarks(
			requireDatabase(platform),
			locals.user.id,
			parsed.entries,
			{ skipped: parsed.skipped }
		);
		return json(result, { status: 201 });
	} catch (error) {
		if (error instanceof CustomNavigationError)
			return json({ error: error.message, field: error.field ?? null }, { status: error.status });
		return json({ error: 'Invalid request' }, { status: 400 });
	}
};
