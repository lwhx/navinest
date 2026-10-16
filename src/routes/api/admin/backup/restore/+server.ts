import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { readBackupRequest } from '$lib/server/backup-request';
import { restoreSiteBackup, BackupRestoreError } from '$lib/server/services/site-backup';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	try {
		const backup = await readBackupRequest(event),
			backupDigest = event.request.headers.get('x-backup-digest') ?? '',
			stateDigest = event.request.headers.get('x-backup-state') ?? '';
		if (
			!/^[a-f0-9]{64}$/.test(backupDigest) ||
			!/^[a-f0-9]{64}$/.test(stateDigest) ||
			event.request.headers.get('x-backup-confirmed') !== 'yes'
		)
			throw new BackupRestoreError('请先检查预览，并确认恢复范围。', 428);
		return json({
			success: true,
			restored: await restoreSiteBackup(requireDatabase(event.platform), backup, {
				backupDigest,
				stateDigest
			})
		});
	} catch (error) {
		if (error instanceof BackupRestoreError)
			return json(
				{ error: error.message, details: error.details, uncertain: error.uncertain },
				{ status: error.status }
			);
		console.error('Backup restore preparation failed', error);
		return json({ error: '无法准备恢复，请重新检查预览后再试。' }, { status: 503 });
	}
};
