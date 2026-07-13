import { error } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { getPublicContentFile } from '$lib/server/services/public-content-files';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ platform, params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404);
	if (!platform?.env?.FILES) error(503);
	const file = await getPublicContentFile(requireDatabase(platform), id);
	if (!file) error(404);
	const object = await platform.env.FILES.get(file.objectKey);
	if (!object) error(404);
	const type = file.mimeType?.startsWith('image/') ? file.mimeType : 'application/octet-stream';
	return new Response(object.body, {
		headers: {
			'content-type': type,
			'cache-control': 'public, max-age=31536000, s-maxage=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-disposition': type === 'image/svg+xml' ? 'attachment' : 'inline'
		}
	});
};
