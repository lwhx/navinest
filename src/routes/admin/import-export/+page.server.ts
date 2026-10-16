import {
	DEFAULT_BACKUP_RETENTION,
	listScheduledBackups,
	type BackupBucket
} from '$lib/server/services/scheduled-backup';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ platform }) => {
	try {
		return {
			backups: await listScheduledBackups(
				platform?.env?.FILES as unknown as BackupBucket | undefined
			),
			retention: DEFAULT_BACKUP_RETENTION,
			backupError: platform?.env?.FILES ? '' : '尚未配置备份存储。'
		};
	} catch (error) {
		console.error('Backup listing unavailable', error);
		return {
			backups: [],
			retention: DEFAULT_BACKUP_RETENTION,
			backupError: '暂时无法读取备份列表，请刷新重试。'
		};
	}
};
