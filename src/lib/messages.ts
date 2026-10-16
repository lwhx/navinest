export const MESSAGE_PAGE_SIZE = 20;
export const messageTypeLabels: Record<string, string> = {
	announcement: '公告',
	system: '系统通知',
	submission_review: '投稿审核',
	cron_alert: '任务提醒'
};
export function messageDate(value: string | null) {
	if (!value) return '时间未知';
	const date = new Date(
		value.replace(' ', 'T') + (/([zZ]|[+-]\d{2}:\d{2})$/.test(value) ? '' : 'Z')
	);
	return Number.isFinite(date.getTime())
		? new Intl.DateTimeFormat('zh-CN', {
				timeZone: 'Asia/Shanghai',
				dateStyle: 'medium',
				timeStyle: 'short'
			}).format(date)
		: '时间未知';
}
export function messageFilters(params: URLSearchParams, admin = false) {
	const page = Number(params.get('page'));
	const status = params.get('status') ?? 'all',
		type = params.get('type') ?? 'all';
	return {
		q: (params.get('q') ?? '').trim().slice(0, 160),
		page: Number.isSafeInteger(page) && page > 0 ? page : 1,
		status: (admin ? ['all', 'sent', 'withdrawn'] : ['all', 'unread', 'read']).includes(status)
			? status
			: 'all',
		type: Object.hasOwn(messageTypeLabels, type) ? type : 'all'
	};
}
export type MessageFilters = ReturnType<typeof messageFilters>;
export function messageUrl(
	path: '/admin/messages' | '/user/messages',
	filters: MessageFilters,
	changes: Partial<MessageFilters> = {}
) {
	const next = { ...filters, ...changes },
		params = new URLSearchParams();
	if (next.q) params.set('q', next.q);
	if (next.type !== 'all') params.set('type', next.type);
	if (next.status !== 'all') params.set('status', next.status);
	if (next.page > 1) params.set('page', String(next.page));
	return path + (params.size ? '?' + params : '');
}
