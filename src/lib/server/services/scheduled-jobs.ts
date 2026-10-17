import { TASKS, type TaskId } from '$lib/task-monitor';
import {
	claimTaskRun,
	finishTaskRun,
	taskError,
	type TaskRequest
} from '$lib/server/services/task-runs';
import type { Database } from '$lib/server/db';
import { sendAlertWebhook } from '$lib/server/services/alert-webhook';
import { alertActiveAdmins, executeMonitoredHotnewsCron } from '$lib/server/services/cron-health';
import { refreshEnabledHotSources } from '$lib/server/services/hotnews';
import { runMaintenance, type MaintenanceResult } from '$lib/server/services/maintenance';
import { runScheduledBackup, type BackupBucket } from '$lib/server/services/scheduled-backup';
import type { SiteBackup } from '$lib/server/services/site-backup';

export const HOTNEWS_CRON = TASKS[0].cron;
export const BACKUP_CRON = TASKS[1].cron;
export const MAINTENANCE_CRON = TASKS[2].cron;
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
	request?: TaskRequest;
	exporter?: (db: Database, now?: Date) => Promise<SiteBackup>;
};

export type ScheduledJobResult =
	| {
			job: 'hotnews';
			runId: number;
			status: 'success' | 'partial' | 'failed';
			totalSources: number;
			succeededSources: number;
			failedSources: number;
			alertWarning?: string;
			results: import('$lib/server/services/cron-health').RefreshResult[];
	  }
	| { job: 'backup'; key: string; bytes: number; pruned: string[] }
	| ({ job: 'maintenance' } & MaintenanceResult)
	| { job: 'skipped'; task: TaskId }
	| { job: 'idle'; cron: string }
	| { job: 'unknown'; cron: string };

/** One shared trigger preserves each daily job's time. Legacy triggers remain compatible during rollout. */
async function executeTask(
	database: Database,
	cron: string,
	scheduledTime: number,
	options: ScheduledJobOptions,
	runId: number
): Promise<ScheduledJobResult> {
	if (cron === HOTNEWS_CRON) {
		const run = await executeMonitoredHotnewsCron(
			database,
			cron,
			scheduledTime,
			() => refreshEnabledHotSources(database),
			{ alertWebhookUrl: options.alertWebhookUrl, fetcher: options.fetcher, runId }
		);
		return {
			job: 'hotnews',
			runId: run.runId,
			status: run.status,
			totalSources: run.totalSources,
			succeededSources: run.succeededSources,
			results: run.results,
			failedSources: run.failedSources,
			alertWarning: run.alertWarning
		};
	}
	if (cron === BACKUP_CRON) {
		try {
			const backup = await runScheduledBackup(options.bucket, database, {
				now: new Date(scheduledTime),
				exporter: options.exporter,
				manualRunId: options.request?.trigger === 'manual' ? runId : undefined
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

/** Shared claim covers scheduled delivery, legacy expressions and administrator requests. */
export async function runScheduledJob(
	database: Database,
	triggerCron: string,
	scheduledTime: number,
	options: ScheduledJobOptions = {}
): Promise<ScheduledJobResult> {
	const cron = triggerCron === SCHEDULER_CRON ? getDueJobCron(scheduledTime) : triggerCron;
	if (cron === null) return { job: 'idle', cron: triggerCron };
	const task = TASKS.find((task) => task.cron === cron);
	if (!task) return { job: 'unknown', cron };
	const id = await claimTaskRun(
		database,
		task.id,
		scheduledTime,
		options.request ?? { trigger: 'scheduled' }
	);
	if (id === null) return { job: 'skipped', task: task.id };
	const started = Date.now();
	try {
		const result = await executeTask(database, cron, scheduledTime, options, id);
		if (result.job === 'hotnews') {
			await finishTaskRun(
				database,
				id,
				{
					status: result.status,
					summary: `来源 ${result.totalSources} · 成功 ${result.succeededSources} · 失败 ${result.failedSources}${result.alertWarning ? ` · ${result.alertWarning}` : ''}`,
					sources: result.results,
					total: result.totalSources,
					succeeded: result.succeededSources,
					failed: result.failedSources
				},
				Date.now() - started
			);
		} else if (result.job === 'backup') {
			await finishTaskRun(
				database,
				id,
				{
					status: 'success',
					summary: `已保存 ${result.key}（${result.bytes} 字节），清理 ${result.pruned.length} 份旧快照`,
					data: result
				},
				Date.now() - started
			);
		} else if (result.job === 'maintenance') {
			await finishTaskRun(
				database,
				id,
				{
					status: 'success',
					summary: `过期会话 ${result.expiredSessions} · 登录记录 ${result.staleLoginAttempts} · 任务记录 ${result.prunedCronRuns} · 失效预留 ${result.abandonedReservations}`,
					data: result
				},
				Date.now() - started
			);
		}
		return result;
	} catch (error) {
		const message = taskError(error);
		await finishTaskRun(
			database,
			id,
			{ status: 'failed', summary: '任务未能完成' },
			Date.now() - started,
			message
		);
		if (task.id === 'maintenance') {
			try {
				await alertActiveAdmins(database, '系统清理失败', `系统清理未能完成：${message}`, {
					cronRunId: id,
					cron,
					scheduledTime
				});
				if (options.alertWebhookUrl)
					await sendAlertWebhook(
						options.alertWebhookUrl,
						{
							title: '系统清理失败',
							content: `系统清理未能完成：${message}`,
							data: { cronRunId: id, cron, scheduledTime }
						},
						options.fetcher
					);
			} catch (alertError) {
				console.error('Maintenance alert failed', alertError);
			}
		}
		throw error;
	}
}
