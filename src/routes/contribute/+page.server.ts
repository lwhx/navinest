import { fail, redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { listCategories } from '$lib/server/services/categories';
import { loadSiteSettings } from '$lib/server/services/site-settings';
import { isContributionType } from '$lib/contribution-types';
import { createSubmission, SubmissionError } from '$lib/server/services/submissions';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	if (!locals.user) redirect(303, '/login');
	const database = getDatabase(platform);
	return {
		user: locals.user,
		contributionType: isContributionType(url.searchParams.get('type'))
			? (url.searchParams.get('type') as 'site' | 'post')
			: ('site' as const),
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
			['type', 'title', 'summary', 'content', 'url', 'tagInput'].map((name) => [
				name,
				String(form.get(name) ?? '')
			])
		);
		values.userCategoryId = String(form.get('categoryId') ?? '');
		const database = requireDatabase(platform);
		if (!(await loadSiteSettings(database)).submissionsOpen)
			return fail(403, {
				message: '投稿通道已关闭。',
				fields: {} as Record<string, string>,
				values
			});
		try {
			await createSubmission(database, locals.user.id, {
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
		redirect(303, '/user/submissions');
	}
};
