import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { validateItemInput } from '$lib/server/admin-validation';
import { reviewSubmission, SubmissionReviewError } from '$lib/server/services/submission-review';
import type { RequestHandler } from './$types';
export const PATCH: RequestHandler = async ({ locals, platform, params, request }) => {
	if (!locals.admin?.id) return json({ error: 'Administrator identity required' }, { status: 403 });
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0)
		return json({ error: 'Invalid submission ID' }, { status: 400 });
	try {
		const body = (await request.json()) as Record<string, unknown>;
		if (body.decision === 'reject') {
			const result = await reviewSubmission(requireDatabase(platform), id, locals.admin.id, {
				decision: 'reject',
				message: String(body.message ?? '')
			});
			return json(result);
		}
		if (body.decision !== 'approve') return json({ error: 'Invalid decision' }, { status: 400 });
		const validation = validateItemInput(
			body.item && typeof body.item === 'object' ? (body.item as Record<string, unknown>) : {}
		);
		if (!validation.valid)
			return json({ error: 'Validation failed', fields: validation.errors }, { status: 400 });
		const result = await reviewSubmission(requireDatabase(platform), id, locals.admin.id, {
			decision: 'approve',
			message: String(body.message ?? ''),
			item: validation.data,
			newTagNames: Array.isArray(body.newTagNames) ? body.newTagNames.map(String) : []
		});
		return json(result);
	} catch (error) {
		if (error instanceof SubmissionReviewError)
			return json({ error: error.message }, { status: error.status });
		console.error('Submission review API failed', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
