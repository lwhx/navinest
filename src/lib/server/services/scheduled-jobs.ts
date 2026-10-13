import type { Database } from '$lib/server/db';
import { sendAlertWebhook } from '$lib/server/services/alert-webhook';
import { alertActiveAdmins, executeMonitoredHotnewsCron } from '$lib/server/services/cron-health';
import { refreshEnabledHotSources } from '$lib/server/services/hotnews';
import { runMaintenance, type MaintenanceResult } from '$lib/server/services/maintenance';
import { runScheduledBackup, type BackupBucket } from '$lib/server/services/scheduled-backup';
import type { SiteBackup } from '$lib/server/services/site-backup';

export const HOTNEWS_CRON = '15 1 * * *';
export const BACKUP_CRON = '0 19 * * *';
export const MAINTENANCE_CRON = '0 3 * * *';
export const SCHEDULER_CRON = '*/15 * * * *';

/** Select by the event's planned UTC time, even when delivery is delayed. */
export function getDueJobCron(scheduledTime: number): string | null {
	const time = new Date(scheduledTime);
	if (!Number.isFinite(time.getTime())) throw new RangeError('Invalid scheduled time.');
	const hour = time.getUTCHours();
	const minute = time.getUTCMinutes();
	if (hour === 1 && minute === 15) return HOTNEWS_CRON;
	if (hour === 19 && minute === 0) return BACKUP_CRON;
	if (hour === 3 && minute === 0) return MAINTENANCE_CRON;
	return null;
}

export type ScheduledJobOptions = {
	bucket?: BackupBucket;
	alertWebhookUrl?: string;
	fetcher?: typeof fetch;
	exporter?: (db: Database, now?: Date) => Promise<SiteBackup>;
};

export type ScheduledJobResult =
	| { job: 'hotnews'; runId: number; status: string; failedSources: number }
	| { job: 'backup'; key: string; bytes: number; pruned: string[] }
	| ({ job: 'maintenance' } & MaintenanceResult)
	| { job: 'idle'; cron: string }
	| { job: 'unknown'; cron: string };

/** One shared trigger preserves each daily job's time. Legacy triggers remain compatible during rollout. */
export async function runScheduledJob(
	database: Database,
	triggerCron: string,
	scheduledTime: number,
	options: ScheduledJobOptions = {}
): Promise<ScheduledJobResult> {
	const cron = triggerCron === SCHEDULER_CRON ? getDueJobCron(scheduledTime) : triggerCron;
	if (cron === null) return { job: 'idle', cron: triggerCron };
	if (cron === HOTNEWS_CRON) {
		const run = await executeMonitoredHotnewsCron(
			database,
			cron,
			scheduledTime,
			() => refreshEnabledHotSources(database),
			{ alertWebhookUrl: options.alertWebhookUrl, fetcher: options.fetcher }
		);
		return {
			job: 'hotnews',
			runId: run.runId,
			status: run.status,
			failedSources: run.failedSources
		};
	}
	if (cron === BACKUP_CRON) {
		try {
			const backup = await runScheduledBackup(options.bucket, database, {
				now: new Date(scheduledTime),
				exporter: options.exporter
			});
			return { job: 'backup', key: backup.key, bytes: backup.bytes, pruned: backup.pruned };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await alertActiveAdmins(database, '定时备份失败', `定时备份未能完成：${message}`, {
				cron,
				scheduledTime,
				error: message
			});
			if (options.alertWebhookUrl)
				await sendAlertWebhook(
					options.alertWebhookUrl,
					{
						title: '定时备份失败',
						content: `定时备份未能完成：${message}`,
						data: { cron, scheduledTime }
					},
					options.fetcher
				);
			throw error;
		}
	}
	if (cron === MAINTENANCE_CRON) return { job: 'maintenance', ...(await runMaintenance(database)) };
	return { job: 'unknown', cron };
}
