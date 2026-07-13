import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { restoreSiteBackup, validateSiteBackup } from '$lib/server/services/site-backup';
import type { RequestHandler } from './$types';
const MAX = 2 * 1024 * 1024;
export const POST: RequestHandler = async ({ platform, request }) => {
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > MAX) return json({ error: 'Backup exceeds 2 MiB limit' }, { status: 413 });
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > MAX)
		return json({ error: 'Backup exceeds 2 MiB limit' }, { status: 413 });
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return json({ error: 'Invalid JSON backup' }, { status: 400 });
	}
	const checked = validateSiteBackup(value);
	if (!checked.valid)
		return json({ error: 'Invalid backup', details: checked.errors }, { status: 400 });
	try {
		return json({
			success: true,
			restored: await restoreSiteBackup(requireDatabase(platform), checked.data)
		});
	} catch (error) {
		console.error('Backup restore failed', error);
		return json({ error: 'Restore failed' }, { status: 500 });
	}
};
