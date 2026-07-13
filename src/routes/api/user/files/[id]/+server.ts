import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { deleteOwnedFile, getOwnedFile, UserFileError } from '$lib/server/services/user-files';
import type { RequestHandler } from './$types';
function id(value: string) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
export const GET: RequestHandler = async ({ locals, platform, params }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	const fileId = id(params.id);
	if (!fileId) return json({ error: 'Invalid file ID' }, { status: 400 });
	if (!platform?.env?.FILES) return json({ error: 'File storage unavailable' }, { status: 503 });
	try {
		const file = await getOwnedFile(requireDatabase(platform), locals.user.id, fileId);
		const object = await platform.env.FILES.get(file.objectKey);
		if (!object) return json({ error: 'File object not found' }, { status: 404 });
		const headers = new Headers();
		headers.set('Content-Type', file.mimeType ?? 'application/octet-stream');
		headers.set('Cache-Control', 'private, max-age=300');
		headers.set('X-Content-Type-Options', 'nosniff');
		headers.set('Content-Disposition', file.mimeType === 'image/svg+xml' ? 'attachment' : 'inline');
		return new Response(object.body, { headers });
	} catch (error) {
		if (error instanceof UserFileError)
			return json({ error: error.message }, { status: error.status });
		console.error('User file read failed', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	const fileId = id(params.id);
	if (!fileId) return json({ error: 'Invalid file ID' }, { status: 400 });
	if (!platform?.env?.FILES) return json({ error: 'File storage unavailable' }, { status: 503 });
	try {
		await deleteOwnedFile(requireDatabase(platform), platform.env.FILES, locals.user.id, fileId);
		return json({ success: true });
	} catch (error) {
		if (error instanceof UserFileError)
			return json({ error: error.message }, { status: error.status });
		console.error('User file delete failed', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
