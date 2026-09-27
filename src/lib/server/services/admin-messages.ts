import type { Database } from '$lib/server/db';
import { AdminWriteError } from '$lib/server/services/admin-write';
import type { ValidationResult } from '$lib/server/admin-validation';

export const MESSAGE_SCOPES = ['user', 'all', 'admins'] as const;
export const MESSAGE_TYPES = ['announcement', 'system'] as const;

export type MessageScope = (typeof MESSAGE_SCOPES)[number];
export type NoticeType = (typeof MESSAGE_TYPES)[number];

export type AdminMessageInput = {
	scope: MessageScope;
	userId: number | null;
	type: NoticeType;
	title: string;
	content: string | null;
};

export type MessageBatch = {
	batchId: string;
	sender: string | null;
	type: string;
	title: string;
	recipients: number;
	read: number;
	createdAt: string;
};

export type MessageStats = {
	batches: number;
	announcements: number;
	system: number;
	review: number;
	unread: number;
};

export function validateAdminMessageInput(
	input: Record<string, unknown>
): ValidationResult<AdminMessageInput> {
	const errors: Record<string, string> = {};
	const scope = typeof input.scope === 'string' ? input.scope : 'all';
	if (!MESSAGE_SCOPES.includes(scope as MessageScope)) errors.scope = '接收范围无效。';

	const type = typeof input.type === 'string' ? input.type : 'announcement';
	if (!MESSAGE_TYPES.includes(type as NoticeType)) errors.type = '消息类型无效。';

	const title = typeof input.title === 'string' ? input.title.trim() : '';
	if (!title) errors.title = '标题不能为空。';
	else if (title.length > 120) errors.title = '标题不能超过 120 个字符。';

	const content = typeof input.content === 'string' ? input.content.trim() : '';
	if (content.length > 2000) errors.content = '正文不能超过 2000 个字符。';

	const rawUserId = input.userId;
	const userId =
		typeof rawUserId === 'number'
			? rawUserId
			: typeof rawUserId === 'string' && /^\d+$/.test(rawUserId)
				? Number(rawUserId)
				: null;
	if (scope === 'user' && !userId) errors.userId = '请选择接收用户。';

	return Object.keys(errors).length
		? { valid: false as const, errors }
		: {
				valid: true as const,
				data: {
					scope: scope as MessageScope,
					userId,
					type: type as NoticeType,
					title,
					content: content || null
				}
			};
}

export async function listMessageRecipients(database: Database) {
	const { results } = await database
		.prepare(
			`SELECT id,username,display_name,role FROM users WHERE status='active'
			 ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, id LIMIT 500`
		)
		.all<{ id: number; username: string; display_name: string; role: string }>();
	return results.map((row) => ({
		id: row.id,
		username: row.username,
		displayName: row.display_name,
		role: row.role
	}));
}

export async function listMessageBatches(database: Database): Promise<MessageBatch[]> {
	const { results } = await database
		.prepare(
			`SELECT m.batch_id batch_id,MAX(u.display_name) sender,m.type type,m.title title,
			 COUNT(*) recipients,SUM(m.is_read) read_count,MIN(m.created_at) created_at
			 FROM messages m LEFT JOIN users u ON u.id=m.sender_id
			 WHERE m.batch_id IS NOT NULL
			 GROUP BY m.batch_id
			 ORDER BY created_at DESC LIMIT 100`
		)
		.all<{
			batch_id: string;
			sender: string | null;
			type: string;
			title: string;
			recipients: number;
			read_count: number | null;
			created_at: string;
		}>();
	return results.map((row) => ({
		batchId: row.batch_id,
		sender: row.sender,
		type: row.type,
		title: row.title,
		recipients: Number(row.recipients),
		read: Number(row.read_count ?? 0),
		createdAt: row.created_at
	}));
}

export async function messageStats(database: Database): Promise<MessageStats> {
	const row = (
		await database
			.prepare(
				`SELECT
				 (SELECT COUNT(DISTINCT batch_id) FROM messages WHERE batch_id IS NOT NULL) batches,
				 (SELECT COUNT(*) FROM messages WHERE type='announcement') announcements,
				 (SELECT COUNT(*) FROM messages WHERE type='system') system,
				 (SELECT COUNT(*) FROM messages WHERE type='submission_review') review,
				 (SELECT COUNT(*) FROM messages WHERE is_read=0) unread`
			)
			.all<{
				batches: number;
				announcements: number;
				system: number;
				review: number;
				unread: number;
			}>()
	).results[0];
	return {
		batches: Number(row?.batches ?? 0),
		announcements: Number(row?.announcements ?? 0),
		system: Number(row?.system ?? 0),
		review: Number(row?.review ?? 0),
		unread: Number(row?.unread ?? 0)
	};
}

async function resolveRecipients(database: Database, input: AdminMessageInput) {
	if (input.scope === 'user') {
		const row = (
			await database
				.prepare("SELECT id FROM users WHERE id=? AND status='active' LIMIT 1")
				.bind(input.userId)
				.all<{ id: number }>()
		).results[0];
		if (!row) throw new AdminWriteError('接收用户不存在或已停用。', 'userId', 404);
		return [row.id];
	}
	const { results } = await database
		.prepare(
			input.scope === 'admins'
				? "SELECT id FROM users WHERE status='active' AND role='admin' LIMIT 1000"
				: "SELECT id FROM users WHERE status='active' LIMIT 1000"
		)
		.all<{ id: number }>();
	if (!results.length) throw new AdminWriteError('没有可接收的账号。', 'scope', 409);
	return results.map((row) => row.id);
}

export async function sendAdminMessage(
	database: Database,
	senderId: number | null,
	input: AdminMessageInput
) {
	const recipients = await resolveRecipients(database, input);
	const batchId = crypto.randomUUID();
	const statement = database.prepare(
		`INSERT INTO messages(user_id,sender_id,type,title,content,batch_id,is_read)
		 VALUES(?,?,?,?,?,?,0)`
	);
	for (const userId of recipients)
		await statement.bind(userId, senderId, input.type, input.title, input.content, batchId).all();
	return { batchId, recipients: recipients.length };
}

export async function withdrawMessageBatch(database: Database, batchId: string) {
	const trimmed = batchId.trim();
	if (!trimmed) throw new AdminWriteError('批次无效。');
	const { results } = await database
		.prepare('DELETE FROM messages WHERE batch_id=? RETURNING id')
		.bind(trimmed)
		.all<{ id: number }>();
	if (!results.length) throw new AdminWriteError('该批次不存在或已被撤回。', undefined, 404);
	return results.length;
}
