import { fail, redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import {
	AdminFileError,
	deleteAdminFile,
	loadMediaPage,
	storeAdminFile
} from '$lib/server/services/admin-files';
import { MEDIA_PAGE_SIZE, mediaFilters, mediaQuery } from '$lib/media-library';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const database = getDatabase(platform);
	return {
		...(database
			? await loadMediaPage(database, url.searchParams)
			: {
					files: [],
					filters: mediaFilters(url.searchParams),
					total: 0,
					pageCount: 1,
					pageSize: MEDIA_PAGE_SIZE
				}),
		source: database ? ('database' as const) : ('fallback' as const),
		storageAvailable: Boolean(platform?.env?.FILES)
	};
};

function actionError(error: unknown) {
	if (error instanceof AdminFileError)
		return fail(error.status, { success: false, message: error.message });
	console.error('Administrator file operation failed', error);
	return fail(500, { success: false, message: '文件操作失败，请稍后重试。' });
}

export const actions: Actions = {
	upload: async ({ platform, request, locals, url }) => {
		const formData = await request.formData();
		const file = formData.get('file');
		if (!(file instanceof File))
			return fail(400, { success: false, message: '请选择要上传的文件。' });
		if (!platform?.env?.FILES)
			return fail(503, { success: false, message: 'R2 文件存储当前不可用。' });
		try {
			await storeAdminFile({
				database: requireDatabase(platform),
				bucket: platform.env.FILES,
				file,
				userId: locals.admin?.id ?? null
			});
		} catch (error) {
			return actionError(error);
		}
		redirect(303, `/admin/files?${mediaQuery(mediaFilters(url.searchParams))}`);
	},
	delete: async ({ platform, request, url }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));
		if (!Number.isInteger(id) || id <= 0)
			return fail(400, { success: false, message: '文件 ID 无效。' });
		if (!platform?.env?.FILES)
			return fail(503, { success: false, message: 'R2 文件存储当前不可用。' });
		try {
			await deleteAdminFile(requireDatabase(platform), platform.env.FILES, id);
		} catch (error) {
			return actionError(error);
		}
		redirect(303, `/admin/files?${mediaQuery(mediaFilters(url.searchParams))}`);
	}
};
