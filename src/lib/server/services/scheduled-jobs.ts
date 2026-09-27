import type { Database } from '$lib/server/db';
import { sendAlertWebhook } from '$lib/server/services/alert-webhook';
import { alertActiveAdmins, executeMonitoredHotnewsCron } from '$lib/server/services/cron-health';
import { refreshEnabledHotSources } from '$lib/server/services/hotnews';
import { runScheduledBackup, type BackupBucket } from '$lib/server/services/scheduled-backup';
import type { SiteBackup } from '$lib/server/services/site-backup';

export const HOTNEWS_CRON = '15 1 * * *';
export const BACKUP_CRON = '0 19 * * *';

export type ScheduledJobOptions = {
	bucket?: BackupBucket;
	alertWebhookUrl?: string;
	fetcher?: typeof fetch;
	exporter?: (db: Database, now?: Date) => Promise<SiteBackup>;
};

export type ScheduledJobResult =
	| { job: 'hotnews'; runId: number; status: string; failedSources: number }
	| { job: 'backup'; key: string; bytes: number; pruned: string[] }
	| { job: 'unknown'; cron: string };

/** Dispatches one cron trigger to its job; unknown triggers are reported instead of failing the worker. */
export async function runScheduledJob(
	database: Database,
	cron: string,
	scheduledTime: number,
	options: ScheduledJobOptions = {}
): Promise<ScheduledJobResult> {
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
	return { job: 'unknown', cron };
}
