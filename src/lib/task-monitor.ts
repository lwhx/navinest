export const TASKS = [
	{
		id: 'hotnews',
		name: '热榜刷新',
		cron: '15 1 * * *',
		hour: 1,
		minute: 15,
		time: '每天 09:15',
		description: '刷新已启用且缓存到期的热榜源，记录各来源结果。'
	},
	{
		id: 'backup',
		name: '数据备份',
		cron: '0 19 * * *',
		hour: 19,
		minute: 0,
		time: '每天 03:00',
		description: '将站点数据保存到备份存储，保留最近 14 份定时快照。'
	},
	{
		id: 'maintenance',
		name: '系统清理',
		cron: '0 3 * * *',
		hour: 3,
		minute: 0,
		time: '每天 11:00',
		description: '清理过期会话、登录记录、旧任务记录和失效的用量预留。'
	}
] as const;
export type TaskId = (typeof TASKS)[number]['id'];
export function isTaskId(value: unknown): value is TaskId {
	return TASKS.some((task) => task.id === value);
}
export function nextTaskTime(task: (typeof TASKS)[number], now: Date) {
	const next = new Date(now);
	next.setUTCHours(task.hour, task.minute, 0, 0);
	if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
	return next.toISOString();
}
export function utcTimestamp(value: string) {
	return /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value.replace(' ', 'T') + 'Z';
}
export function taskTime(value: string | null) {
	if (!value) return '—';
	const date = new Date(utcTimestamp(value));
	if (!Number.isFinite(date.getTime())) return value;
	return new Intl.DateTimeFormat('zh-CN', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	}).format(date);
}
export function taskDuration(value: number | null) {
	if (value === null) return '—';
	if (value < 1000) return `${Math.round(value)} 毫秒`;
	if (value < 60_000) return `${(value / 1000).toFixed(1)} 秒`;
	return `${Math.floor(value / 60_000)} 分 ${Math.round((value % 60_000) / 1000)} 秒`;
}
export const TASK_STATUS: Record<string, string> = {
	success: '成功',
	partial: '部分失败',
	failed: '失败',
	running: '运行中',
	interrupted: '长时间未完成'
};
