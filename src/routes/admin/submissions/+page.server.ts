import { fail, redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { itemFormInput, parsePositiveId } from '$lib/server/admin-mutations';
import { loadSubmissionQueue, getAdminSubmission } from '$lib/server/services/admin-submissions';
import { listCategories } from '$lib/server/services/categories';
import { listTags } from '$lib/server/services/tags';
import { submissionQueueFilters, submissionQueueUrl } from '$lib/submission-queue';
import {
	performReviewRequest,
	reviewRequestError
} from '$lib/server/services/submission-review-request';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url, locals }) => {
	const db = getDatabase(platform),
		filters = submissionQueueFilters(url.searchParams);
	const empty = {
		submissions: [],
		selected: null,
		selectedPage: null,
		selectedUnavailable: false,
		filters,
		summary: {} as Record<string, number>,
		total: 0,
		pageCount: 1,
		pageSize: 20,
		categories: [],
		tags: [],
		completed: null
	};
	const extra = { requestKey: crypto.randomUUID(), reviewActorId: locals.admin?.id ?? null };
	if (!db)
		return {
			...empty,
			...extra,
			source: 'fallback' as const,
			readError: '数据库不可用，无法审核投稿。'
		};
	try {
		const [queue, categories, tags] = await Promise.all([
			loadSubmissionQueue(db, url.searchParams),
			listCategories(db, { visibleOnly: false }),
			listTags(db)
		]);
		const done = parsePositiveId(url.searchParams.get('completed') ?? '');
		const completed = done ? await getAdminSubmission(db, done) : null;
		return {
			...queue,
			categories,
			tags,
			completed:
				completed &&
				!completed.processing &&
				['published', 'approved', 'rejected'].includes(completed.status)
					? completed
					: null,
			...extra,
			source: 'database' as const,
			readError: ''
		};
	} catch (cause) {
		console.error('Failed to read submission queue', cause);
		return {
			...empty,
			...extra,
			source: 'unavailable' as const,
			readError: '审核队列暂时无法读取，请刷新后核对。'
		};
	}
};
export const actions: Actions = {
	review: async ({ platform, request, locals, url }) => {
		if (!locals.admin?.id)
			return fail(403, { message: '需要管理员身份。', fields: {}, values: {}, id: null });
		const form = await request.formData(),
			id = parsePositiveId(String(form.get('id') ?? ''));
		const values: Record<string, string | string[]> = Object.create(null);
		for (const key of new Set([...form.keys()]))
			values[key] = form.getAll(key).filter((value): value is string => typeof value === 'string');
		if (!id) return fail(400, { message: '投稿编号无效。', fields: {}, values, id: null });
		try {
			await performReviewRequest(requireDatabase(platform), id, locals.admin.id, {
				decision: form.get('decision'),
				message: form.get('message'),
				requestKey: form.get('requestKey'),
				previousKey: form.get('previousKey'),
				item: itemFormInput(form),
				newTagNames: form.getAll('newTagNames')
			});
		} catch (cause) {
			const failure = reviewRequestError(cause);
			return fail(failure.status, { message: failure.message, fields: failure.fields, values, id });
		}
		const target = new URL(
			submissionQueueUrl(submissionQueueFilters(url.searchParams), { submission: null }),
			url
		);
		target.searchParams.set('completed', String(id));
		redirect(303, target.pathname + target.search);
	}
};
