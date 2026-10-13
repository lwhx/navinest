import type { Database } from '$lib/server/db';
import { DatabaseUnavailableError } from '$lib/server/db';
import { validateItemInput } from '$lib/server/admin-validation';
import { AdminWriteError } from './admin-write';
import { getAdminSubmission } from './admin-submissions';
import { validReviewKey, type ReviewAttempt } from '$lib/submission-queue';
import {
	cancelUnstartedReview,
	reviewSubmission,
	SubmissionReviewError
} from './submission-review';

export class ReviewValidationError extends SubmissionReviewError {
	constructor(public readonly fields: Record<string, string>) {
		super('请检查表单中的错误。');
	}
}
export async function performReviewRequest(
	database: Database,
	id: number,
	reviewerId: number,
	body: Record<string, unknown>
) {
	if (
		body.requestKey === body.previousKey ||
		!validReviewKey(body.requestKey) ||
		typeof body.previousKey !== 'string' ||
		(body.previousKey !== '' && !validReviewKey(body.previousKey))
	)
		throw new SubmissionReviewError('审核请求标识无效，请刷新页面后重试。');
	const attempt: ReviewAttempt = { key: body.requestKey, previousKey: body.previousKey };
	if (body.decision === 'cancel-unstarted') return cancelUnstartedReview(database, id, attempt);
	const submission = await getAdminSubmission(database, id);
	if (!submission) throw new SubmissionReviewError('投稿不存在。', 404);
	if (!submission.payloadAvailable)
		throw new SubmissionReviewError('投稿数据无法读取，请先核对原始记录。');
	const message = typeof body.message === 'string' ? body.message.trim() : '';
	if (message.length > 2000)
		throw new ReviewValidationError({ message: '审核意见不能超过 2000 个字符。' });
	if (body.decision === 'reject') {
		if (!message) throw new ReviewValidationError({ message: '拒绝投稿时必须填写审核意见。' });
		return reviewSubmission(database, id, reviewerId, { decision: 'reject', message }, attempt);
	}
	if (body.decision !== 'approve') throw new SubmissionReviewError('请选择有效的审核操作。');
	if (
		body.item &&
		typeof body.item === 'object' &&
		(body.item as Record<string, unknown>).type !== submission.type
	)
		throw new ReviewValidationError({ type: '发布内容类型必须与投稿一致。' });
	const validation = validateItemInput(
		body.item && typeof body.item === 'object' && !Array.isArray(body.item)
			? (body.item as Record<string, unknown>)
			: {}
	);
	if (!validation.valid) throw new ReviewValidationError(validation.errors);
	if (validation.data.type !== submission.type)
		throw new ReviewValidationError({ type: '发布内容类型必须与投稿一致。' });
	return reviewSubmission(
		database,
		id,
		reviewerId,
		{
			decision: 'approve',
			message,
			item: validation.data,
			newTagNames: Array.isArray(body.newTagNames) ? body.newTagNames.map(String) : []
		},
		attempt
	);
}
export function reviewRequestError(cause: unknown) {
	if (cause instanceof ReviewValidationError)
		return { status: 400, message: cause.message, fields: cause.fields };
	if (cause instanceof SubmissionReviewError)
		return { status: cause.status, message: cause.message, fields: {} as Record<string, string> };
	if (cause instanceof AdminWriteError)
		return {
			status: cause.status,
			message: cause.message,
			fields: cause.field ? { [cause.field]: cause.message } : ({} as Record<string, string>)
		};
	if (
		cause instanceof Error &&
		/UNIQUE constraint failed:\s*items\.(?:type,\s*items\.)?slug|SQLITE_CONSTRAINT_UNIQUE.*items.*slug/i.test(
			cause.message
		)
	)
		return {
			status: 409,
			message: '内容地址已存在，请使用其他值。',
			fields: { slug: '同一内容类型下的内容地址必须唯一。' }
		};
	if (cause instanceof DatabaseUnavailableError)
		return {
			status: 503,
			message: '数据库暂时无法读取，请核对审核状态。',
			fields: {} as Record<string, string>
		};
	console.error('Submission review request failed', cause);
	return {
		status: 500,
		message: '审核结果暂时无法确认，请核对状态。',
		fields: {} as Record<string, string>
	};
}
