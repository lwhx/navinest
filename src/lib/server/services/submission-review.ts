import type { Database } from '$lib/server/db';
import type { ItemInput } from '$lib/server/admin-validation';
import { createItem, deleteItem } from '$lib/server/services/admin-write';
import { createReviewMessage } from '$lib/server/services/user-messages';

export class SubmissionReviewError extends Error {
	constructor(
		message: string,
		public readonly status: 400 | 404 | 409 = 400
	) {
		super(message);
		this.name = 'SubmissionReviewError';
	}
}
type ReviewInput =
	| { decision: 'reject'; message: string }
	| { decision: 'approve'; message: string; item: ItemInput };
async function pending(database: Database, id: number) {
	const row = (
		await database
			.prepare(
				"SELECT id,user_id,title,type FROM submissions WHERE id=? AND status='pending' LIMIT 1"
			)
			.bind(id)
			.all<{ id: number; user_id: number; title: string; type: string }>()
	).results[0];
	if (!row) {
		const exists = (
			await database
				.prepare('SELECT id FROM submissions WHERE id=? LIMIT 1')
				.bind(id)
				.all<{ id: number }>()
		).results[0];
		throw new SubmissionReviewError(
			exists ? '投稿已经审核，不能重复处理。' : '投稿不存在。',
			exists ? 409 : 404
		);
	}
	return row;
}
export async function reviewSubmission(
	database: Database,
	submissionId: number,
	reviewerId: number,
	input: ReviewInput
) {
	const submission = await pending(database, submissionId);
	const message = input.message.trim();
	if (input.decision === 'reject') {
		if (!message) throw new SubmissionReviewError('拒绝投稿时必须填写审核意见。');
		const row = (
			await database
				.prepare(
					"UPDATE submissions SET status='rejected',reviewer_id=?,review_message=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' RETURNING id"
				)
				.bind(reviewerId, message, submissionId)
				.all<{ id: number }>()
		).results[0];
		if (!row) throw new SubmissionReviewError('投稿已经审核，不能重复处理。', 409);
		try {
			await createReviewMessage(database, {
				userId: submission.user_id,
				senderId: reviewerId,
				submissionId,
				submissionTitle: submission.title,
				status: 'rejected',
				content: message,
				item: null
			});
		} catch (error) {
			await database
				.prepare(
					"UPDATE submissions SET status='pending',reviewer_id=NULL,review_message=NULL,reviewed_at=NULL WHERE id=?"
				)
				.bind(submissionId)
				.all();
			throw error;
		}
		return { status: 'rejected' as const, itemId: null };
	}
	const publishInput: ItemInput = { ...input.item, status: 'published', visibility: 'public' };
	const itemId = await createItem(database, publishInput, reviewerId);
	try {
		const row = (
			await database
				.prepare(
					"UPDATE submissions SET status='published',target_item_id=?,reviewer_id=?,review_message=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' RETURNING id"
				)
				.bind(itemId, reviewerId, message || null, submissionId)
				.all<{ id: number }>()
		).results[0];
		if (!row) throw new SubmissionReviewError('投稿已经审核，不能重复处理。', 409);
		await createReviewMessage(database, {
			userId: submission.user_id,
			senderId: reviewerId,
			submissionId,
			submissionTitle: submission.title,
			status: 'published',
			content: message || '投稿已通过审核并发布。',
			item: { id: itemId, type: publishInput.type, slug: publishInput.slug }
		});
	} catch (error) {
		await database
			.prepare(
				"UPDATE submissions SET status='pending',target_item_id=NULL,reviewer_id=NULL,review_message=NULL,reviewed_at=NULL WHERE id=?"
			)
			.bind(submissionId)
			.all();
		await deleteItem(database, itemId);
		throw error;
	}
	return { status: 'published' as const, itemId };
}
