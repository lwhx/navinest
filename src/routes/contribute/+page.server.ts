import { error, fail, redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { listCategories } from '$lib/server/services/categories';
import { loadSiteSettings } from '$lib/server/services/site-settings';
import { isContributionType } from '$lib/contribution-types';
import { loadResubmission } from '$lib/server/services/user-submissions';
import { submissionId } from '$lib/user-submissions';
import { createSubmission, SubmissionError } from '$lib/server/services/submissions';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	if (!locals.user) redirect(303, '/login');
	const database = getDatabase(platform);
	const requested = url.searchParams.get('resubmit');
	const resubmission =
		requested && database
			? await loadResubmission(database, locals.user.id, submissionId(requested) ?? 0)
			: null;
	if (requested && !resubmission) error(404, '找不到这条投稿。');
	return {
		resubmission,
		user: locals.user,
		contributionType:
			resubmission?.draft?.type ??
			(isContributionType(url.searchParams.get('type'))
				? (url.searchParams.get('type') as 'site' | 'post')
				: ('site' as const)),
		submissionsOpen: (await loadSiteSettings(database)).submissionsOpen,
		categories: database
			? (await listCategories(database, { visibleOnly: true })).filter((category) =>
					isContributionType(category.type)
				)
			: []
	};
};

export const actions: Actions = {
	default: async ({ locals, platform, request }) => {
		if (!locals.user) redirect(303, '/login');
		const form = await request.formData();
		const values: Record<string, string> = Object.fromEntries(
			[
				'type',
				'title',
				'summary',
				'content',
				'url',
				'tagInput',
				'iconFileId',
				'iconSource',
				'sourceSubmissionId'
			].map((name) => [name, String(form.get(name) ?? '')])
		);
		values.userCategoryId = String(form.get('categoryId') ?? '');
		const database = requireDatabase(platform);
		if (!(await loadSiteSettings(database)).submissionsOpen)
			return fail(403, {
				message: '投稿通道已关闭。',
				fields: {} as Record<string, string>,
				values
			});
		let id: number;
		try {
			id = await createSubmission(database, locals.user.id, {
				sourceSubmissionId: values.sourceSubmissionId ? Number(values.sourceSubmissionId) : null,
				iconFileId: values.iconFileId ? Number(values.iconFileId) : null,
				iconSource:
					values.iconSource === 'auto' || values.iconSource === 'manual' ? values.iconSource : null,
				type: values.type,
				title: values.title,
				summary: values.summary,
				content: values.content,
				url: values.url,
				userCategoryId: values.userCategoryId ? Number(values.userCategoryId) : null,
				tagNames: values.tagInput.split(/[，,\n]/)
			});
		} catch (error) {
			if (!(error instanceof SubmissionError)) throw error;
			return fail(400, {
				message: error.message,
				fields: error.field ? { [error.field]: error.message } : {},
				values
			});
		}
		redirect(
			303,
			values.sourceSubmissionId
				? `/user/submissions?submission=${id}#submission-detail`
				: '/user/submissions'
		);
	}
};
