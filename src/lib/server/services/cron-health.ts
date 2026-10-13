import type { Database } from '$lib/server/db';
import { sendAlertWebhook, type CronAlert } from '$lib/server/services/alert-webhook';

export type RefreshResult =
	| { ok: true; sourceId: number; count: number; skipped?: boolean }
	| { ok: false; sourceId: number; error: string };
type Refresh = () => Promise<RefreshResult[]>;
export type CronAlertOptions = {
	/** An already claimed unified task run; its owner persists the final outcome. */
	runId?: number;
	alertWebhookUrl?: string;
	fetcher?: typeof fetch;
	staleAfterHours?: number;
};
export const DEFAULT_STALE_HOURS = 48;
type RunRow = {
	id: number;
	cron: string;
	scheduled_at: string;
	started_at: string;
	finished_at: string | null;
	status: string;
	total_sources: number;
	succeeded_sources: number;
	failed_sources: number;
	result_json: string;
	error_message: string | null;
};
function cleanError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}
/** Alerts every active administrator with an in-app message. */
export async function alertActiveAdmins(
	database: Database,
	title: string,
	content: string,
	data: Record<string, unknown>
) {
	await database
		.prepare(
			"INSERT INTO messages(user_id,sender_id,type,title,content,data_json,is_read) SELECT id,NULL,'cron_alert',?,?,?,0 FROM users WHERE role='admin' AND status='active'"
		)
		.bind(title, content, JSON.stringify(data))
		.all();
}
/** Enabled boards whose last success is older than the threshold, i.e. boards that silently stopped updating. */
async function staleEnabledSources(database: Database, hours: number) {
	const rows = (
		await database
			.prepare(
				"SELECT id,name,last_success_at FROM hot_sources WHERE is_enabled=1 AND (last_success_at IS NULL OR unixepoch(last_success_at)<=unixepoch('now')-?) ORDER BY id"
			)
			.bind(Math.max(1, Math.trunc(hours)) * 3600)
			.all<{ id: number; name: string; last_success_at: string | null }>()
	).results;
	return rows.map((row) => ({
		sourceId: row.id,
		name: row.name,
		lastSuccessAt: row.last_success_at
	}));
}
/** External webhook delivery is best effort: it must never fail the cron run itself. */
async function notify(options: CronAlertOptions, alert: CronAlert) {
	if (!options.alertWebhookUrl) return;
	try {
		await sendAlertWebhook(options.alertWebhookUrl, alert, options.fetcher);
	} catch {
		// ignored on purpose
	}
}
export async function executeMonitoredHotnewsCron(
	database: Database,
	cron: string,
	scheduledTime: number,
	refresh: Refresh,
	options: CronAlertOptions = {}
) {
	const scheduledAt = new Date(scheduledTime).toISOString();
	const inserted = options.runId
		? { id: options.runId }
		: (
				await database
					.prepare(
						"INSERT INTO cron_runs(cron,scheduled_at,status) VALUES(?,?,'running') RETURNING id"
					)
					.bind(cron, scheduledAt)
					.all<{ id: number }>()
			).results[0];
	if (!inserted) throw new Error('Cron运行记录创建失败。');
	try {
		const results = await refresh();
		const succeeded = results.filter((x) => x.ok).length,
			failed = results.length - succeeded,
			status: 'success' | 'failed' | 'partial' =
				failed === 0 ? 'success' : succeeded === 0 ? 'failed' : 'partial';
		if (!options.runId)
			await database
				.prepare(
					'UPDATE cron_runs SET finished_at=CURRENT_TIMESTAMP,status=?,total_sources=?,succeeded_sources=?,failed_sources=?,result_json=? WHERE id=?'
				)
				.bind(status, results.length, succeeded, failed, JSON.stringify(results), inserted.id)
				.all();
		if (failed > 0) {
			const failures = results
				.filter((x): x is Extract<RefreshResult, { ok: false }> => !x.ok)
				.map((x) => ({ sourceId: x.sourceId, error: cleanError(x.error) }));
			const staleSources = await staleEnabledSources(
				database,
				options.staleAfterHours ?? DEFAULT_STALE_HOURS
			);
			await alertActiveAdmins(
				database,
				'热榜定时刷新异常',
				`${failed} 个热榜源刷新失败，请在后台定时任务页面查看详情。${staleSources.length ? `当前有 ${staleSources.length} 个榜单长时间未成功更新。` : ''}`,
				{ cronRunId: inserted.id, scheduledAt, failures, staleSources }
			);
			await notify(options, {
				title: `热榜定时刷新异常（${failed} 个源失败）`,
				content: `${failed} 个热榜源刷新失败，请在后台定时任务页面查看详情。\n${failures.map((failure) => `#${failure.sourceId} ${failure.error}`).join('\n')}`,
				data: { cronRunId: inserted.id, cron, scheduledAt, status, failures, staleSources }
			});
		} else {
			const staleSources = await staleEnabledSources(
				database,
				options.staleAfterHours ?? DEFAULT_STALE_HOURS
			);
			if (staleSources.length)
				await notify(options, {
					title: `热榜榜单长时间未更新（${staleSources.length} 个）`,
					content: `以下榜单超过 ${options.staleAfterHours ?? DEFAULT_STALE_HOURS} 小时没有成功更新：\n${staleSources
						.map(
							(source) =>
								`#${source.sourceId} ${source.name}（最后成功：${source.lastSuccessAt ?? '从未'}）`
						)
						.join('\n')}`,
					data: { cronRunId: inserted.id, cron, scheduledAt, status, staleSources }
				});
		}
		return {
			runId: inserted.id,
			status,
			totalSources: results.length,
			succeededSources: succeeded,
			failedSources: failed,
			results
		};
	} catch (error) {
		const message = cleanError(error);
		if (!options.runId)
			await database
				.prepare(
					"UPDATE cron_runs SET finished_at=CURRENT_TIMESTAMP,status='failed',error_message=? WHERE id=?"
				)
				.bind(message, inserted.id)
				.all();
		await alertActiveAdmins(
			database,
			'热榜定时任务失败',
			'热榜定时任务未能完成，请在后台定时任务页面查看详情。',
			{ cronRunId: inserted.id, scheduledAt, error: message }
		);
		await notify(options, {
			title: '热榜定时任务失败',
			content: `热榜定时任务未能完成：${message}`,
			data: { cronRunId: inserted.id, cron, scheduledAt, error: message }
		});
		throw error;
	}
}
export async function listCronRuns(database: Database, limit = 50) {
	const rows = (
		await database
			.prepare(
				'SELECT id,cron,scheduled_at,started_at,finished_at,status,total_sources,succeeded_sources,failed_sources,result_json,error_message FROM cron_runs ORDER BY started_at DESC,id DESC LIMIT ?'
			)
			.bind(Math.max(1, Math.min(100, limit)))
			.all<RunRow>()
	).results;
	return rows.map((r) => ({
		id: r.id,
		cron: r.cron,
		scheduledAt: r.scheduled_at,
		startedAt: r.started_at,
		finishedAt: r.finished_at,
		status: r.status,
		totalSources: r.total_sources,
		succeededSources: r.succeeded_sources,
		failedSources: r.failed_sources,
		results: (() => {
			try {
				const parsed = JSON.parse(r.result_json ?? '[]');
				return (
					Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sources) ? parsed.sources : []
				) as RefreshResult[];
			} catch {
				return [];
			}
		})(),
		errorMessage: r.error_message
	}));
}
