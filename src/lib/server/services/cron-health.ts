import type { Database } from '$lib/server/db';

type RefreshResult =
	{ ok: true; sourceId: number; count: number } | { ok: false; sourceId: number; error: string };
type Refresh = () => Promise<RefreshResult[]>;
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
async function alertAdmins(
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
export async function executeMonitoredHotnewsCron(
	database: Database,
	cron: string,
	scheduledTime: number,
	refresh: Refresh
) {
	const scheduledAt = new Date(scheduledTime).toISOString();
	const inserted = (
		await database
			.prepare("INSERT INTO cron_runs(cron,scheduled_at,status) VALUES(?,?,'running') RETURNING id")
			.bind(cron, scheduledAt)
			.all<{ id: number }>()
	).results[0];
	if (!inserted) throw new Error('Cron运行记录创建失败。');
	try {
		const results = await refresh();
		const succeeded = results.filter((x) => x.ok).length,
			failed = results.length - succeeded,
			status = failed === 0 ? 'success' : succeeded === 0 ? 'failed' : 'partial';
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
			await alertAdmins(
				database,
				'热榜定时刷新异常',
				`${failed} 个热榜源刷新失败，请在后台定时任务页面查看详情。`,
				{ cronRunId: inserted.id, scheduledAt, failures }
			);
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
		await database
			.prepare(
				"UPDATE cron_runs SET finished_at=CURRENT_TIMESTAMP,status='failed',error_message=? WHERE id=?"
			)
			.bind(message, inserted.id)
			.all();
		await alertAdmins(
			database,
			'热榜定时任务失败',
			'热榜定时任务未能完成，请在后台定时任务页面查看详情。',
			{ cronRunId: inserted.id, scheduledAt, error: message }
		);
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
		results: JSON.parse(r.result_json) as RefreshResult[],
		errorMessage: r.error_message
	}));
}
