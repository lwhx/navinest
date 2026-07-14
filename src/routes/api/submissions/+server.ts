import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { createSubmission, SubmissionError } from '$lib/server/services/submissions';
import type { RequestHandler } from './$types';
function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const web = record(body.webSnapshot),
			ai = record(body.aiSuggestion),
			id = await createSubmission(requireDatabase(platform), locals.user.id, {
				type: String(body.type ?? ''),
				title: String(body.title ?? ''),
				summary: body.summary === null ? null : String(body.summary ?? ''),
				content: body.content === null ? null : String(body.content ?? ''),
				url: body.url === null ? null : String(body.url ?? ''),
				tagNames: Array.isArray(body.tagNames) ? body.tagNames.map(String) : [],
				webSnapshot: web
					? {
							fetchedUrl: String(web.fetchedUrl ?? ''),
							title: String(web.title ?? ''),
							description: String(web.description ?? ''),
							excerpt: String(web.excerpt ?? ''),
							siteName: String(web.siteName ?? ''),
							fetchedAt: String(web.fetchedAt ?? '')
						}
					: null,
				aiSuggestion: ai
					? {
							title: String(ai.title ?? ''),
							summary: String(ai.summary ?? ''),
							content: String(ai.content ?? ''),
							tags: Array.isArray(ai.tags) ? ai.tags.map(String) : [],
							provider: String(ai.provider ?? ''),
							model: String(ai.model ?? ''),
							generatedAt: String(ai.generatedAt ?? '')
						}
					: null
			});
		return json({ id, status: 'pending' }, { status: 201 });
	} catch (error) {
		if (error instanceof SubmissionError)
			return json({ error: error.message, field: error.field ?? null }, { status: 400 });
		console.error('Submission API failed', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
