import type { Database } from '$lib/server/db';
import { TASKS, utcTimestamp, type TaskId } from '$lib/task-monitor';

export const INTERRUPTED_AFTER_MS = 30 * 60_000;
export type TaskActor = { id: number | null; displayName: string };
export type TaskRequest =
	{ trigger: 'manual'; requestKey: string; actor: TaskActor } | { trigger: 'scheduled' };
export type TaskOutcome = {
	status: 'success' | 'partial' | 'failed';
	summary: string;
	data?: unknown;
	sources?: unknown[];
	total?: number;
	succeeded?: number;
	failed?: number;
};
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
	result_json: string | null;
	error_message: string | null;
};
function metadata(value: string | null): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value ?? '[]');
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
export function taskError(error: unknown) {
	return (error instanceof Error ? error.message : String(error))
		.replace(/[\r\n\t]+/g, ' ')
		.slice(0, 500);
}
/** A single INSERT ... SELECT is the claim: D1 serializes the check and insertion atomically.
 * Running claims never expire automatically, including after an interrupted invocation. */
export async function claimTaskRun(
	database: Database,
	task: TaskId,
	scheduledTime: number,
	request: TaskRequest
) {
	const cron = TASKS.find((value) => value.id === task)!.cron;
	const scheduledAt = new Date(scheduledTime).toISOString();
	if (request.trigger === 'manual' && !/^[a-zA-Z0-9_-]{16,80}$/.test(request.requestKey))
		throw new Error('补跑请求标识无效，请刷新页面。');
	const requestKey = request.trigger === 'manual' ? request.requestKey : `scheduled:${scheduledAt}`;
	const value = {
		version: 1,
		trigger: request.trigger,
		requestKey,
		actor: request.trigger === 'manual' ? request.actor : null
	};
	const row = (
		await database
			.prepare(
				`INSERT INTO cron_runs(cron,scheduled_at,status,result_json)
		SELECT ?,?,'running',? WHERE NOT EXISTS (SELECT 1 FROM cron_runs WHERE cron=? AND status='running')
		AND NOT EXISTS (SELECT 1 FROM cron_runs WHERE cron=? AND (json_extract(CASE WHEN json_valid(result_json) THEN result_json ELSE '{}' END,'$.requestKey')=?
		OR (?='scheduled' AND scheduled_at=? AND COALESCE(json_extract(CASE WHEN json_valid(result_json) THEN result_json ELSE '{}' END,'$.trigger'),'scheduled')='scheduled')))
		RETURNING id`
			)
			.bind(
				cron,
				scheduledAt,
				JSON.stringify(value),
				cron,
				cron,
				requestKey,
				request.trigger,
				scheduledAt
			)
			.all<{ id: number }>()
	).results[0];
	return row?.id ?? null;
}
export async function finishTaskRun(
	database: Database,
	id: number,
	outcome: TaskOutcome,
	durationMs: number,
	error: string | null = null
) {
	await database
		.prepare(
			`UPDATE cron_runs SET finished_at=CURRENT_TIMESTAMP,status=?,total_sources=?,succeeded_sources=?,failed_sources=?,
		result_json=json_set(result_json,'$.summary',?,'$.data',json(?),'$.sources',json(?),'$.durationMs',?),error_message=? WHERE id=? AND status='running'`
		)
		.bind(
			outcome.status,
			outcome.total ?? 0,
			outcome.succeeded ?? 0,
			outcome.failed ?? 0,
			outcome.summary,
			JSON.stringify(outcome.data ?? null),
			JSON.stringify(outcome.sources ?? []),
			Math.max(0, durationMs),
			error,
			id
		)
		.all();
}
/** Release is an explicit administrator decision, not an automatic lease takeover or a cancellation. */
export async function releaseInterruptedTask(database: Database, id: number, actor: TaskActor) {
	const rows = (
		await database
			.prepare(
				`UPDATE cron_runs SET status='failed',finished_at=CURRENT_TIMESTAMP,error_message='管理员核对后解除了运行标记；此操作不会终止原执行。',
		result_json=json_set(CASE WHEN json_valid(result_json) AND json_type(result_json)='object' THEN result_json ELSE '{}' END,'$.releasedBy',json(?))
		WHERE id=? AND status='running' AND unixepoch(started_at)<=unixepoch('now')-1800 AND cron IN (?,?,?) RETURNING id`
			)
			.bind(JSON.stringify(actor), id, ...TASKS.map((task) => task.cron))
			.all<{ id: number }>()
	).results;
	return rows.length > 0;
}
function normalize(row: RunRow, now: number) {
	const details = metadata(row.result_json);
	const job = TASKS.find((task) => task.cron === row.cron);
	const started = Date.parse(utcTimestamp(row.started_at));
	const interrupted =
		row.status === 'running' && Number.isFinite(started) && now - started >= INTERRUPTED_AFTER_MS;
	let sources: unknown[] = [];
	try {
		const parsed = JSON.parse(row.result_json ?? '[]');
		sources = Array.isArray(parsed)
			? parsed
			: Array.isArray(details.sources)
				? details.sources
				: [];
	} catch {
		/* keep a malformed historical record visible */
	}
	const duration =
		typeof details.durationMs === 'number' && Number.isFinite(details.durationMs)
			? Math.max(0, details.durationMs)
			: row.finished_at && Number.isFinite(started)
				? Math.max(0, Date.parse(utcTimestamp(row.finished_at)) - started)
				: null;
	const actor = details.actor as TaskActor | null;
	return {
		id: row.id,
		task: job?.id ?? null,
		name: job?.name ?? '历史任务',
		status: interrupted ? 'interrupted' : row.status,
		scheduledAt: row.scheduled_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		durationMs: Number.isFinite(duration) ? duration : null,
		trigger: details.trigger === 'manual' ? 'manual' : 'scheduled',
		actor: actor && typeof actor.displayName === 'string' ? actor.displayName : null,
		summary:
			typeof details.summary === 'string'
				? details.summary
				: job?.id === 'hotnews'
					? `来源 ${row.total_sources} · 成功 ${row.succeeded_sources} · 失败 ${row.failed_sources}`
					: '历史记录未包含结果摘要',
		error: row.error_message,
		sources: sources
			.map((source) => {
				if (!source || typeof source !== 'object') return null;
				const item = source as Record<string, unknown>;
				return typeof item.sourceId === 'number'
					? `来源 ${item.sourceId}：${item.ok === true ? (item.skipped === true ? '缓存有效，保留已有结果' : `成功 ${Number(item.count) || 0} 条`) : `失败 ${String(item.error ?? '未知错误')}`}`
					: null;
			})
			.filter((source): source is string => source !== null)
	};
}
export type TaskRun = ReturnType<typeof normalize>;
export async function loadTaskMonitor(
	database: Database,
	filter: TaskId | null = null,
	now = new Date()
) {
	const cron = filter ? TASKS.find((task) => task.id === filter)!.cron : null;
	const rows = (
		await database
			.prepare(
				`SELECT * FROM cron_runs ${cron ? 'WHERE cron=?' : ''} ORDER BY started_at DESC,id DESC LIMIT 50`
			)
			.bind(...(cron ? [cron] : []))
			.all<RunRow>()
	).results;
	const jobs = await Promise.all(
		TASKS.map(async (task) => {
			const latest = (
				await database
					.prepare('SELECT * FROM cron_runs WHERE cron=? ORDER BY started_at DESC,id DESC LIMIT 1')
					.bind(task.cron)
					.all<RunRow>()
			).results[0];
			const active = (
				await database
					.prepare(
						"SELECT * FROM cron_runs WHERE cron=? AND status='running' ORDER BY started_at DESC,id DESC LIMIT 1"
					)
					.bind(task.cron)
					.all<RunRow>()
			).results[0];
			const success = (
				await database
					.prepare(
						"SELECT finished_at FROM cron_runs WHERE cron=? AND status='success' ORDER BY started_at DESC,id DESC LIMIT 1"
					)
					.bind(task.cron)
					.all<{ finished_at: string | null }>()
			).results[0];
			return {
				id: task.id,
				latest: latest ? normalize(latest, now.getTime()) : null,
				active: active ? normalize(active, now.getTime()) : null,
				lastSuccessAt: success?.finished_at ?? null
			};
		})
	);
	return { runs: rows.map((row) => normalize(row, now.getTime())), jobs };
}
