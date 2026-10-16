import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { readBackupRequest } from '$lib/server/backup-request';
import { previewSiteBackup, BackupRestoreError } from '$lib/server/services/site-backup';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	try {
		return json({
			preview: await previewSiteBackup(
				requireDatabase(event.platform),
				await readBackupRequest(event)
			)
		});
	} catch (error) {
		if (error instanceof BackupRestoreError)
			return json({ error: error.message, details: error.details }, { status: error.status });
		console.error('Backup preview failed', error);
		return json({ error: '无法读取站点数据进行预览，请稍后重新检查。' }, { status: 503 });
	}
};
