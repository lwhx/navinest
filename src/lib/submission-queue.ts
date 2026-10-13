export const SUBMISSION_PAGE_SIZE = 20;
export const submissionStatuses = {
	pending: '待审核',
	reviewing: '处理中',
	published: '已发布',
	approved: '已通过',
	rejected: '已拒绝'
} as const;
export type SubmissionQueueFilters = {
	status: string;
	q: string;
	page: number;
	submission: number | null;
};
export type ReviewAttempt = { key: string; previousKey: string };
export type ReviewReceipt = { key: string; state: 'running' | 'succeeded' | 'failed' };

export function submissionQueueFilters(params: URLSearchParams): SubmissionQueueFilters {
	const requested = params.get('status') ?? 'pending';
	const page = Number(params.get('page') ?? 1),
		id = Number(params.get('submission'));
	return {
		status: ['pending', 'reviewing', 'published', 'approved', 'rejected', 'all'].includes(requested)
			? requested
			: 'pending',
		q: (params.get('q') ?? '').trim().slice(0, 160),
		page: Number.isSafeInteger(page) && page > 0 ? page : 1,
		submission: Number.isSafeInteger(id) && id > 0 ? id : null
	};
}
export function submissionQueueUrl(
	filters: SubmissionQueueFilters,
	changes: Partial<SubmissionQueueFilters> = {}
) {
	const next = { ...filters, ...changes },
		params = new URLSearchParams();
	params.set('status', next.status);
	if (next.q) params.set('q', next.q);
	if (next.page > 1) params.set('page', String(next.page));
	if (next.submission) params.set('submission', String(next.submission));
	return '/admin/submissions?' + params;
}
export function validReviewKey(key: unknown): key is string {
	return typeof key === 'string' && /^[a-zA-Z0-9-]{16,100}$/.test(key);
}
export function reviewReceipt(payload: unknown): ReviewReceipt | null {
	if (!payload || typeof payload !== 'object') return null;
	const value = (payload as { _review?: unknown })._review;
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	return validReviewKey(record.key) &&
		['running', 'succeeded', 'failed'].includes(String(record.state))
		? { key: record.key, state: record.state as ReviewReceipt['state'] }
		: null;
}
