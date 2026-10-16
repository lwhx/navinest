import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { AdminFileError, loadMediaPage, storeAdminFile } from '$lib/server/services/admin-files';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, url }) => {
	try {
		const page = await loadMediaPage(
			requireDatabase(platform),
			url.searchParams,
			url.searchParams.get('images') === '1'
		);
		return json({ data: page.files, page });
	} catch (error) {
		console.error('Administrator file listing API failed', error);
		return json({ error: '图片列表暂时无法读取，请重试。' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
	try {
		if (!platform?.env?.FILES)
			return json({ error: '图片存储暂不可用，请稍后重试。' }, { status: 503 });
		const formData = await request.formData();
		const file = formData.get('file');
		if (!(file instanceof File)) return json({ error: '请选择要上传的图片。' }, { status: 400 });
		const record = await storeAdminFile({
			database: requireDatabase(platform),
			bucket: platform.env.FILES,
			file,
			userId: locals.admin?.id ?? null
		});
		return json({ data: record }, { status: 201 });
	} catch (error) {
		if (error instanceof AdminFileError)
			return json({ error: error.message }, { status: error.status });
		console.error('Administrator file upload API failed', error);
		return json({ error: '图片上传失败，请稍后重试。' }, { status: 500 });
	}
};
