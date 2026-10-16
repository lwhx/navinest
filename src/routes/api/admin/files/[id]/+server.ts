import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { AdminFileError, deleteAdminFile, getAdminFile } from '$lib/server/services/admin-files';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) return json({ error: 'Invalid file ID' }, { status: 400 });
	if (!platform?.env?.FILES) return json({ error: 'File storage unavailable' }, { status: 503 });
	const file = await getAdminFile(requireDatabase(platform), id);
	if (!file || file.bucket !== 'FILES') return json({ error: 'File not found' }, { status: 404 });
	const object = await platform.env.FILES.get(file.objectKey);
	if (!object) return json({ error: 'File object not found' }, { status: 404 });
	const type = file.mimeType?.startsWith('image/') ? file.mimeType : 'application/octet-stream';
	return new Response(object.body, {
		headers: {
			'content-type': type,
			'cache-control': 'private, max-age=300',
			'x-content-type-options': 'nosniff',
			'content-disposition': type === 'image/svg+xml' ? 'attachment' : 'inline'
		}
	});
};

export const DELETE: RequestHandler = async ({ platform, params }) => {
	try {
		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0)
			return json({ error: 'Invalid file ID' }, { status: 400 });
		if (!platform?.env?.FILES) return json({ error: 'File storage unavailable' }, { status: 503 });
		await deleteAdminFile(requireDatabase(platform), platform.env.FILES, id);
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof AdminFileError)
			return json({ error: error.message }, { status: error.status });
		console.error('Administrator file deletion API failed', error);
		return json({ error: '图片删除失败，请刷新核对后重试。' }, { status: 500 });
	}
};
