import type { Database } from '$lib/server/db';
import { hotHealth, hotErrorDetail, hotTimestamp, HOT_REMINDER_DAYS } from '$lib/hot-health';
import { sendAlertWebhook } from './alert-webhook';
export type HotIssue = { sourceId: number; name: string; kind: string; error: string };
type State = {
	version: 1;
	eventId: string;
	fingerprint: string;
	issues: HotIssue[];
	firstSeen: string;
	lastSeen: string;
	notifiedAt: string;
	observations: number;
	observationId: string;
	kind: 'initial' | 'changed' | 'reminder' | 'recovered' | 'closed';
	webhook: string;
};
const payload = "CASE WHEN json_valid(data_json) THEN data_json ELSE '{}' END";
const healthRows = `type='cron_alert' AND json_extract(${payload},'$._hotHealth.version')=1`;
function readState(raw: string): State | null {
	try {
		const value = JSON.parse(raw)?._hotHealth;
		return value?.version === 1 &&
			Array.isArray(value.issues) &&
			value.issues.every(
				(issue: HotIssue) =>
					issue &&
					Number.isSafeInteger(issue.sourceId) &&
					typeof issue.name === 'string' &&
					typeof issue.error === 'string' &&
					typeof issue.kind === 'string'
			) &&
			typeof value.fingerprint === 'string' &&
			typeof value.eventId === 'string'
			? value
			: null;
	} catch {
		return null;
	}
}
export async function latestHotAlert(database: Database) {
	const row = (
		await database
			.prepare(`SELECT id,data_json FROM messages WHERE ${healthRows} ORDER BY id DESC LIMIT 1`)
			.all<{ id: number; data_json: string }>()
	).results[0];
	return { id: row?.id ?? 0, state: row ? readState(row.data_json) : null };
}
export async function hotIssues(database: Database, fatal?: string): Promise<HotIssue[]> {
	const { results } = await database
		.prepare('SELECT id,name,is_enabled,last_error,last_success_at FROM hot_sources ORDER BY id')
		.all<{
			id: number;
			name: string;
			is_enabled: number;
			last_error: string | null;
			last_success_at: string | null;
		}>();
	const issues: HotIssue[] = [];
	for (const row of results) {
		const health = hotHealth({
			isEnabled: row.is_enabled === 1,
			lastError: row.last_error,
			lastSuccessAt: row.last_success_at
		});
		if (['failed', 'stale', 'waiting'].includes(health.kind))
			issues.push({
				sourceId: row.id,
				name: row.name,
				kind: health.kind,
				error: row.last_error
					? hotErrorDetail(row.last_error).label +
						(row.last_error.match(/HTTP\s*\d{3}/i)
							? `（${row.last_error.match(/HTTP\s*\d{3}/i)![0]}）`
							: '')
					: health.detail
			});
	}
	if (fatal)
		issues.push({
			sourceId: 0,
			name: '热榜任务',
			kind: 'task',
			error: '任务未能完成，请查看运行记录。'
		});
	return issues;
}
/** One conditional statement fans out each state-change event; repeated observations update only metadata. */
export async function reconcileHotAlerts(
	database: Database,
	observationId: string,
	options: {
		issues?: HotIssue[];
		fatal?: string;
		/** Only a completed scheduled observation can resolve a task-level failure. */
		taskObserved?: boolean;
		alertWebhookUrl?: string;
		fetcher?: typeof fetch;
		now?: Date;
		context?: Record<string, unknown>;
	} = {}
) {
	const now = (options.now ?? new Date()).toISOString(),
		previous = await latestHotAlert(database),
		old = previous.state,
		issues = options.issues ?? (await hotIssues(database, options.fatal));
	if (!options.issues && !options.taskObserved && !options.fatal)
		issues.push(...(old?.issues.filter((issue) => issue.sourceId === 0) ?? []));
	issues.sort((a, b) => a.sourceId - b.sourceId);
	const fingerprint = JSON.stringify(issues.map((i) => [i.sourceId, i.kind, i.error]));
	if (old?.observationId === observationId || (hotTimestamp(old?.lastSeen) ?? 0) > Date.parse(now))
		return { emitted: false };
	if (!issues.length && !old?.issues.length) return { emitted: false };
	const same = old?.fingerprint === fingerprint,
		due = Date.parse(now) - (hotTimestamp(old?.notifiedAt) ?? 0) >= HOT_REMINDER_DAYS * 86400000;
	if (same && !due) {
		await database
			.prepare(
				`UPDATE messages SET data_json=json_set(${payload},'$._hotHealth.lastSeen',?,'$._hotHealth.observations',COALESCE(json_extract(${payload},'$._hotHealth.observations'),0)+1,'$._hotHealth.observationId',?) WHERE ${healthRows} AND json_extract(${payload},'$._hotHealth.eventId')=? AND json_extract(${payload},'$._hotHealth.observationId')<>?`
			)
			.bind(now, observationId, old!.eventId, observationId)
			.all();
		return { emitted: false };
	}
	const enabled = new Set(
		(
			await database.prepare('SELECT id FROM hot_sources WHERE is_enabled=1').all<{ id: number }>()
		).results.map((row) => row.id)
	);
	const resolved = (old?.issues ?? []).filter(
		(issue) => !issues.some((current) => current.sourceId === issue.sourceId)
	);
	const recovered = resolved.filter((issue) => issue.sourceId === 0 || enabled.has(issue.sourceId)),
		closed = resolved.filter((issue) => issue.sourceId !== 0 && !enabled.has(issue.sourceId));
	const kind: State['kind'] = !issues.length
		? closed.length && !recovered.length
			? 'closed'
			: 'recovered'
		: !old?.issues.length
			? 'initial'
			: same
				? 'reminder'
				: 'changed';
	const state: State = {
		version: 1,
		eventId: crypto.randomUUID(),
		fingerprint,
		issues,
		firstSeen: old?.issues.length ? old.firstSeen : now,
		lastSeen: now,
		notifiedAt: now,
		observations: old?.issues.length ? Number(old.observations || 0) + 1 : 1,
		observationId,
		kind,
		webhook: options.alertWebhookUrl ? 'pending' : 'disabled'
	};

	const failed = issues.filter((i) => i.kind === 'failed').length;
	const title =
		kind === 'closed'
			? '热榜异常提醒已停止'
			: kind === 'recovered'
				? '热榜刷新已恢复'
				: kind === 'reminder'
					? '热榜持续异常汇总'
					: kind === 'changed'
						? '热榜异常状态变化'
						: '热榜刷新异常';
	const content =
		(kind === 'closed'
			? '相关榜单已停用或移除，已停止本次异常提醒；这不表示订阅已经恢复。'
			: kind === 'recovered'
				? '当前启用榜单已恢复正常。'
				: `${failed ? `${failed} 个热榜源刷新失败；` : ''}当前 ${issues.length} 项异常。`) +
		`\n${issues.map((i) => `${i.name}：${i.error}`).join('\n')}` +
		(recovered.length ? `\n恢复：${recovered.map((i) => i.name).join('、')}` : '') +
		(closed.length ? `\n已停用或移除：${closed.map((issue) => issue.name).join('、')}` : '') +
		(kind === 'reminder' ? `\n已连续观察 ${state.observations} 次。` : '') +
		`\n同一异常每 ${HOT_REMINDER_DAYS} 天汇总一次；状态变化会即时提醒。`;
	const data = { ...options.context, _hotHealth: state };
	const inserted = (
		await database
			.prepare(
				`INSERT INTO messages(user_id,sender_id,type,title,content,data_json,is_read) SELECT id,NULL,'cron_alert',?,?,?,0 FROM users WHERE role='admin' AND status='active' AND COALESCE((SELECT MAX(id) FROM messages WHERE ${healthRows}),0)=? RETURNING id`
			)
			.bind(title, content.slice(0, 2000), JSON.stringify(data), previous.id)
			.all<{ id: number }>()
	).results;
	if (!inserted.length) return { emitted: false };
	let warning: string | undefined;
	if (options.alertWebhookUrl) {
		const delivered = await sendAlertWebhook(
			options.alertWebhookUrl,
			{ title, content: content.slice(0, 2000), data },
			options.fetcher
		);
		state.webhook = delivered.ok ? 'sent' : 'failed';
		if (!delivered.ok) warning = '站内告警已记录，站外推送未确认成功。';
		await database
			.prepare(
				`UPDATE messages SET data_json=json_set(${payload},'$._hotHealth.webhook',?) WHERE ${healthRows} AND json_extract(${payload},'$._hotHealth.eventId')=?`
			)
			.bind(state.webhook, state.eventId)
			.all();
	}
	return { emitted: true, kind, warning };
}
export async function reportHotAlerts(
	database: Database,
	observationId: string,
	options: Parameters<typeof reconcileHotAlerts>[2] = {}
) {
	try {
		return await reconcileHotAlerts(database, observationId, options);
	} catch {
		console.error('Hot-board alert reconciliation failed');
		return {
			emitted: false,
			warning: '刷新结果已记录，但异常通知未能完成，请核对消息与运行记录。'
		};
	}
}
export async function hotAlertSummary(database: Database) {
	const { state } = await latestHotAlert(database);
	return state
		? {
				kind: state.kind,
				lastSeen: state.lastSeen,
				notifiedAt: state.notifiedAt,
				observations: state.observations,
				issues: state.issues.length,
				webhook: state.webhook
			}
		: null;
}
