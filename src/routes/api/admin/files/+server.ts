import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { AdminFileError, listAdminFiles, storeAdminFile } from '$lib/server/services/admin-files';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	try {
		return json({ data: await listAdminFiles(requireDatabase(platform)) });
	} catch (error) {
		console.error('Administrator file listing API failed', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
	try {
		if (!platform?.env?.FILES) return json({ error: 'File storage unavailable' }, { status: 503 });
		const formData = await request.formData();
		const file = formData.get('file');
		if (!(file instanceof File))
			return json({ error: 'A file field is required' }, { status: 400 });
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
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
