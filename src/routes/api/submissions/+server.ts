import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { createSubmission, SubmissionError } from '$lib/server/services/submissions';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const id = await createSubmission(requireDatabase(platform), locals.user.id, {
			type: String(body.type ?? ''),
			title: String(body.title ?? ''),
			summary: body.summary === null ? null : String(body.summary ?? ''),
			content: body.content === null ? null : String(body.content ?? ''),
			url: body.url === null ? null : String(body.url ?? '')
		});
		return json({ id, status: 'pending' }, { status: 201 });
	} catch (error) {
		if (error instanceof SubmissionError)
			return json({ error: error.message, field: error.field ?? null }, { status: 400 });
		console.error('Submission API failed', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
