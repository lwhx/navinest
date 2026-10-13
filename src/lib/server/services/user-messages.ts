import type { Database } from '$lib/server/db';

export class UserMessageError extends Error {
	constructor(
		message: string,
		public readonly status: 404 = 404
	) {
		super(message);
		this.name = 'UserMessageError';
	}
}
type ReviewMessageInput = {
	userId: number;
	senderId: number;
	submissionId: number;
	submissionTitle: string;
	reviewKey?: string;
	status: 'published' | 'rejected';
	content: string;
	item: { id: number; type: string; slug: string } | null;
};
type Row = {
	id: number;
	type: string;
	title: string;
	content: string | null;
	data_json: string | null;
	is_read: number;
	created_at: string;
};
export async function createReviewMessage(database: Database, input: ReviewMessageInput) {
	const title =
		input.status === 'published'
			? `投稿“${input.submissionTitle}”已发布`
			: `投稿“${input.submissionTitle}”未通过审核`;
	const data = {
		submissionId: input.submissionId,
		status: input.status,
		item: input.item,
		...(input.reviewKey ? { reviewKey: input.reviewKey } : {})
	};
	const row = (
		await database
			.prepare(
				"INSERT INTO messages(user_id,sender_id,type,title,content,data_json,is_read) VALUES(?,?,'submission_review',?,?,?,0) RETURNING id"
			)
			.bind(input.userId, input.senderId, title, input.content || null, JSON.stringify(data))
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new UserMessageError('消息创建失败。');
	return row.id;
}
export async function listUserMessages(database: Database, userId: number) {
	const rows = (
		await database
			.prepare(
				'SELECT id,type,title,content,data_json,is_read,created_at FROM messages WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100'
			)
			.bind(userId)
			.all<Row>()
	).results;
	return rows.map((row) => ({
		id: row.id,
		type: row.type,
		title: row.title,
		content: row.content,
		data: row.data_json ? JSON.parse(row.data_json) : null,
		isRead: row.is_read === 1,
		createdAt: row.created_at
	}));
}
export async function markMessageRead(database: Database, userId: number, id: number) {
	const row = (
		await database
			.prepare('UPDATE messages SET is_read=1 WHERE id=? AND user_id=? RETURNING id')
			.bind(id, userId)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new UserMessageError('消息不存在。');
}
