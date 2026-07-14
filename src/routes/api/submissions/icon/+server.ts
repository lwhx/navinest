import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { storeAdminFile, AdminFileError } from '$lib/server/services/admin-files';
import { fetchRemoteIcon, RemoteIconError } from '$lib/server/services/remote-icon';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: '请先登录。' }, { status: 401 });
	if (!platform?.env?.FILES) return json({ error: '文件存储暂时不可用。' }, { status: 503 });
	try {
		const body = (await request.json()) as Record<string, unknown>,
			url = typeof body.url === 'string' ? body.url.trim() : '';
		if (!url || url.length > 2048) return json({ error: '网站图标地址无效。' }, { status: 400 });
		const file = await fetchRemoteIcon(url),
			record = await storeAdminFile({
				database: requireDatabase(platform),
				bucket: platform.env.FILES,
				file,
				userId: locals.user.id
			});
		return json(
			{
				data: {
					id: record.id,
					mimeType: record.mimeType,
					size: record.size,
					previewUrl: `/api/user/files/${record.id}`
				}
			},
			{ status: 201 }
		);
	} catch (error) {
		if (error instanceof RemoteIconError) return json({ error: error.message }, { status: 422 });
		if (error instanceof AdminFileError)
			return json({ error: error.message }, { status: error.status });
		console.error('Submission icon import failed', error instanceof Error ? error.name : 'unknown');
		return json({ error: '网站图标暂时无法保存，请手动上传。' }, { status: 500 });
	}
};
