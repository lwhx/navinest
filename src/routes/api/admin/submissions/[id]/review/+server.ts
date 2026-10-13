import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { readJsonObject } from '$lib/server/admin-mutations';
import { getAdminSubmission } from '$lib/server/services/admin-submissions';
import {
	performReviewRequest,
	reviewRequestError
} from '$lib/server/services/submission-review-request';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, platform, params }) => {
	if (!locals.admin?.id) return json({ error: '需要管理员身份。' }, { status: 403 });
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0)
		return json({ error: '投稿编号无效。' }, { status: 400 });
	try {
		const row = await getAdminSubmission(requireDatabase(platform), id);
		if (!row) return json({ error: '投稿不存在。' }, { status: 404 });
		const {
			title,
			status,
			processing,
			receipt,
			reviewMessage,
			publishedHref,
			publishedTitle,
			updatedAt
		} = row;
		return json({
			data: {
				id,
				title,
				status,
				processing,
				receipt,
				reviewMessage,
				publishedHref,
				publishedTitle,
				updatedAt
			}
		});
	} catch (cause) {
		const failure = reviewRequestError(cause);
		return json({ error: failure.message }, { status: failure.status });
	}
};
export const PATCH: RequestHandler = async ({ locals, platform, params, request }) => {
	if (!locals.admin?.id) return json({ error: '需要管理员身份。' }, { status: 403 });
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0)
		return json({ error: '投稿编号无效。' }, { status: 400 });
	try {
		return json(
			await performReviewRequest(
				requireDatabase(platform),
				id,
				locals.admin.id,
				await readJsonObject(request)
			)
		);
	} catch (cause) {
		const failure = reviewRequestError(cause);
		return json({ error: failure.message, fields: failure.fields }, { status: failure.status });
	}
};
