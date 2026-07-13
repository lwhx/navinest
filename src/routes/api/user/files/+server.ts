import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { AdminFileError, storeAdminFile } from '$lib/server/services/admin-files';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	if (!platform?.env?.FILES) return json({ error: 'File storage unavailable' }, { status: 503 });
	const form = await request.formData(),
		file = form.get('file');
	if (!(file instanceof File)) return json({ error: 'A file field is required' }, { status: 400 });
	try {
		return json(
			{
				data: await storeAdminFile({
					database: requireDatabase(platform),
					bucket: platform.env.FILES,
					file,
					userId: locals.user.id
				})
			},
			{ status: 201 }
		);
	} catch (error) {
		if (error instanceof AdminFileError)
			return json({ error: error.message }, { status: error.status });
		console.error('User file upload failed', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
