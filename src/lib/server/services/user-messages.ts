import type { Database } from '$lib/server/db';
import { MESSAGE_PAGE_SIZE, messageFilters } from '$lib/messages';
import { messageConditions, visibleMessage } from './message-query';

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
function mapMessage(row: Row) {
	let data: {
		submissionId: number | null;
		status: string | null;
		item: { id: number; type: string; slug: string } | null;
	} | null = null;
	try {
		const raw = JSON.parse(row.data_json ?? 'null');
		if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
			const item = raw.item;
			data = {
				status: ['published', 'rejected'].includes(raw.status) ? raw.status : null,
				submissionId:
					Number.isSafeInteger(raw.submissionId) && raw.submissionId > 0 ? raw.submissionId : null,
				item:
					item &&
					Number.isSafeInteger(item.id) &&
					item.id > 0 &&
					['site', 'post', 'app', 'book', 'bulletin'].includes(item.type) &&
					typeof item.slug === 'string' &&
					item.slug
						? { id: item.id, type: item.type, slug: item.slug }
						: null
			};
		}
	} catch {
		/* Invalid historical payloads must not hide the rest of the inbox. */
	}
	return {
		id: row.id,
		type: row.type,
		title: row.title,
		content: row.content,
		data,
		isRead: row.is_read === 1,
		createdAt: row.created_at
	};
}
export async function loadUserMessages(
	database: Database,
	userId: number,
	params: URLSearchParams
) {
	const filters = messageFilters(params),
		{ conditions, values } = messageConditions(filters);
	const where = ['m.user_id=?', ...conditions].join(' AND '),
		bindings = [userId, ...values];
	const totals = (
		await database
			.prepare(
				`SELECT COUNT(*) total,COALESCE(SUM(is_read=0),0) unread FROM messages m WHERE user_id=? AND ${visibleMessage()}`
			)
			.bind(userId)
			.all<{ total: number; unread: number }>()
	).results[0];
	const total = Number(
		(
			await database
				.prepare(`SELECT COUNT(*) n FROM messages m WHERE ${where}`)
				.bind(...bindings)
				.all<{ n: number }>()
		).results[0]?.n ?? 0
	);
	const pageCount = Math.max(1, Math.ceil(total / MESSAGE_PAGE_SIZE));
	filters.page = Math.min(filters.page, pageCount);
	const rows = (
		await database
			.prepare(
				`SELECT m.id,m.type,m.title,m.content,m.data_json,m.is_read,m.created_at FROM messages m WHERE ${where} ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?`
			)
			.bind(...bindings, MESSAGE_PAGE_SIZE, (filters.page - 1) * MESSAGE_PAGE_SIZE)
			.all<Row>()
	).results;
	return {
		messages: rows.map(mapMessage),
		filters,
		total,
		pageCount,
		unread: Number(totals?.unread ?? 0),
		allTotal: Number(totals?.total ?? 0)
	};
}
export async function listUserMessages(database: Database, userId: number) {
	return (await loadUserMessages(database, userId, new URLSearchParams())).messages;
}
export async function markMessageRead(database: Database, userId: number, id: number) {
	const row = (
		await database
			.prepare(
				`UPDATE messages SET is_read=1 WHERE id=? AND user_id=? AND ${visibleMessage('messages')} RETURNING id`
			)
			.bind(id, userId)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new UserMessageError('消息不存在。');
}
