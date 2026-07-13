import { fail, redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import {
	AdminFileError,
	deleteAdminFile,
	listAdminFiles,
	storeAdminFile
} from '$lib/server/services/admin-files';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	const database = getDatabase(platform);
	return {
		files: database ? await listAdminFiles(database) : [],
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
	upload: async ({ platform, request, locals }) => {
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
		redirect(303, '/admin/files?uploaded=1');
	},
	delete: async ({ platform, request }) => {
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
		redirect(303, '/admin/files?deleted=1');
	}
};
