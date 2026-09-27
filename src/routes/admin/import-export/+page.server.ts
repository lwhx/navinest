import {
	DEFAULT_BACKUP_RETENTION,
	listScheduledBackups,
	type BackupBucket
} from '$lib/server/services/scheduled-backup';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ platform }) => ({
	backups: await listScheduledBackups(platform?.env?.FILES as unknown as BackupBucket | undefined),
	retention: DEFAULT_BACKUP_RETENTION
});
