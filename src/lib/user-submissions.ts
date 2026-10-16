export const USER_SUBMISSION_PAGE_SIZE = 20;
export const userSubmissionStatuses = {
	all: '全部状态',
	pending: '待审核',
	reviewing: '处理中',
	rejected: '已退回',
	published: '已发布',
	approved: '已通过',
	draft: '历史草稿'
} as const;
export const submissionTypeLabels: Record<string, string> = {
	site: '网址',
	post: '文章',
	app: '软件（历史）',
	book: '书籍（历史）',
	bulletin: '公告（历史）'
};
export type UserSubmissionFilters = {
	q: string;
	status: keyof typeof userSubmissionStatuses;
	page: number;
	submission: number | null;
};
export function submissionId(value: unknown): number | null {
	if (typeof value !== 'string' && typeof value !== 'number') return null;
	const n = Number(value);
	return Number.isSafeInteger(n) && n > 0 ? n : null;
}
export function userSubmissionFilters(params: URLSearchParams): UserSubmissionFilters {
	const status = params.get('status') ?? 'all';
	return {
		q: (params.get('q') ?? '').trim().slice(0, 160),
		status: Object.hasOwn(userSubmissionStatuses, status)
			? (status as UserSubmissionFilters['status'])
			: 'all',
		page: submissionId(params.get('page')) ?? 1,
		submission: submissionId(params.get('submission'))
	};
}
export function userSubmissionUrl(
	filters: UserSubmissionFilters,
	changes: Partial<UserSubmissionFilters> = {}
) {
	const next = { ...filters, ...changes },
		params = new URLSearchParams();
	if (next.q) params.set('q', next.q);
	if (next.status !== 'all') params.set('status', next.status);
	if (next.page > 1) params.set('page', String(next.page));
	if (next.submission) params.set('submission', String(next.submission));
	return (
		'/user/submissions' +
		(params.size ? '?' + params : '') +
		(next.submission ? '#submission-detail' : '')
	);
}
