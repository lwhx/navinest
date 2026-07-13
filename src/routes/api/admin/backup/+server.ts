import { requireDatabase } from '$lib/server/db';
import { exportSiteBackup } from '$lib/server/services/site-backup';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ platform }) => {
	const backup = await exportSiteBackup(requireDatabase(platform));
	const date = backup.generatedAt?.slice(0, 10) ?? 'backup';
	return new Response(JSON.stringify(backup, null, 2), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="navinest-${date}.json"`,
			'cache-control': 'no-store'
		}
	});
};
