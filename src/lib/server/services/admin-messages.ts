import type { Database } from '$lib/server/db';
import { AdminWriteError } from '$lib/server/services/admin-write';
import type { ValidationResult } from '$lib/server/admin-validation';
import { MESSAGE_PAGE_SIZE, messageFilters } from '$lib/messages';
import { messageConditions, messageJson, visibleMessage } from './message-query';

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
	content: string | null;
	withdrawnAt: string | null;
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
	if (scope === 'user' && (!userId || !Number.isSafeInteger(userId) || userId < 1))
		errors.userId = '请选择接收用户。';

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

export async function listMessageRecipients(database: Database, query = '') {
	const { results } = await database
		.prepare(
			`SELECT id,username,display_name,role FROM users WHERE status='active'
 AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR CAST(id AS TEXT)=?)
 ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, id LIMIT 21`
		)
		.bind(
			'%' + query.replace(/[\\%_]/g, '\\$&') + '%',
			'%' + query.replace(/[\\%_]/g, '\\$&') + '%',
			query
		)
		.all<{ id: number; username: string; display_name: string; role: string }>();
	return {
		recipients: results.slice(0, 20).map((row) => ({
			id: row.id,
			username: row.username,
			displayName: row.display_name,
			role: row.role
		})),
		hasMore: results.length > 20
	};
}
async function batchStorage(database: Database) {
	const { results } = await database.prepare('PRAGMA table_info(messages)').all<{ name: string }>();
	const hasColumn = results.some((row) => row.name === 'batch_id');
	return {
		hasColumn,
		key: (alias = 'm') =>
			hasColumn
				? `COALESCE(${alias}.batch_id,json_extract(${messageJson(alias)},'$.dispatchBatchId'))`
				: `json_extract(${messageJson(alias)},'$.dispatchBatchId')`
	};
}
const batchColumns = (
	key: string
) => `${key} batch_id,MAX(u.display_name) sender,m.type,m.title,MAX(m.content) content,
 COUNT(*) recipients,SUM(m.is_read) read_count,MIN(m.created_at) created_at,
 MAX(json_extract(${messageJson()},'$.withdrawnAt')) withdrawn_at`;
type BatchRow = {
	batch_id: string;
	sender: string | null;
	type: string;
	title: string;
	content: string | null;
	recipients: number;
	read_count: number;
	created_at: string;
	withdrawn_at: string | null;
};
const batchMap = (row: BatchRow): MessageBatch => ({
	batchId: row.batch_id,
	sender: row.sender,
	type: row.type,
	title: row.title,
	content: row.content,
	recipients: Number(row.recipients),
	read: Number(row.read_count),
	createdAt: row.created_at,
	withdrawnAt: row.withdrawn_at
});
export async function getMessageBatch(database: Database, batchId: string) {
	const key = (await batchStorage(database)).key();
	const row = (
		await database
			.prepare(
				`SELECT ${batchColumns(key)} FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE ${key}=? GROUP BY ${key}`
			)
			.bind(batchId)
			.all<BatchRow>()
	).results[0];
	return row ? batchMap(row) : null;
}
export async function loadMessageBatches(database: Database, params: URLSearchParams) {
	const filters = messageFilters(params, true),
		{ conditions, values } = messageConditions(filters, true);
	const key = (await batchStorage(database)).key();
	const where = [`${key} IS NOT NULL`, ...conditions].join(' AND ');
	const total = Number(
		(
			await database
				.prepare(`SELECT COUNT(DISTINCT ${key}) n FROM messages m WHERE ${where}`)
				.bind(...values)
				.all<{ n: number }>()
		).results[0]?.n ?? 0
	);
	const pageCount = Math.max(1, Math.ceil(total / MESSAGE_PAGE_SIZE));
	filters.page = Math.min(filters.page, pageCount);
	const rows = (
		await database
			.prepare(
				`SELECT ${batchColumns(key)} FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE ${where} GROUP BY ${key} ORDER BY created_at DESC,batch_id DESC LIMIT ? OFFSET ?`
			)
			.bind(...values, MESSAGE_PAGE_SIZE, (filters.page - 1) * MESSAGE_PAGE_SIZE)
			.all<BatchRow>()
	).results;
	return { batches: rows.map(batchMap), filters, total, pageCount };
}
export async function listMessageBatches(database: Database) {
	return (await loadMessageBatches(database, new URLSearchParams())).batches;
}

export async function messageStats(database: Database): Promise<MessageStats> {
	const key = (await batchStorage(database)).key();
	const row = (
		await database
			.prepare(
				`SELECT
				 (SELECT COUNT(DISTINCT ${key}) FROM messages m WHERE ${key} IS NOT NULL) batches,
				 (SELECT COUNT(*) FROM messages m WHERE ${visibleMessage()} AND type='announcement') announcements,
				 (SELECT COUNT(*) FROM messages m WHERE ${visibleMessage()} AND type='system') system,
				 (SELECT COUNT(*) FROM messages m WHERE ${visibleMessage()} AND type='submission_review') review,
				 (SELECT COUNT(*) FROM messages m WHERE ${visibleMessage()} AND is_read=0) unread`
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

type Recipient = { id: number; username: string; display_name: string; role: string };
function audience(input: AdminMessageInput) {
	return {
		where:
			"status='active'" +
			(input.scope === 'admins' ? " AND role='admin'" : input.scope === 'user' ? ' AND id=?' : ''),
		values: input.scope === 'user' ? [input.userId] : []
	};
}
async function resolveRecipients(database: Database, input: AdminMessageInput) {
	const { where, values } = audience(input);
	const rows = (
		await database
			.prepare(`SELECT id,username,display_name,role FROM users WHERE ${where} ORDER BY id`)
			.bind(...values)
			.all<Recipient>()
	).results;
	if (!rows.length)
		throw new AdminWriteError(
			input.scope === 'user' ? '接收用户不存在或已停用。' : '没有可接收的账号。',
			input.scope === 'user' ? 'userId' : 'scope',
			409
		);
	// Bound the snapshot size rather than silently dropping recipients.
	if (JSON.stringify(rows).length > 500000)
		throw new AdminWriteError('接收范围过大，请缩小范围。', 'scope', 409);
	return rows;
}
const state = (rows: Recipient[]) =>
	JSON.stringify(rows.map((r) => [r.id, r.username, r.display_name, r.role]));
async function digest(senderId: number | null, input: AdminMessageInput, recipients: Recipient[]) {
	const raw = JSON.stringify([
		senderId,
		input.scope,
		input.scope === 'user' ? input.userId : null,
		input.type,
		input.title,
		input.content,
		state(recipients)
	]);
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))]
		.map((n) => n.toString(16).padStart(2, '0'))
		.join('');
}
export type MessagePreview = {
	batchId: string;
	digest: string;
	createdAt: number;
	recipients: number;
	scopeLabel: string;
	title: string;
	content: string | null;
	type: string;
};
export async function previewAdminMessage(
	database: Database,
	senderId: number | null,
	input: AdminMessageInput
): Promise<MessagePreview> {
	const recipients = await resolveRecipients(database, input);
	return {
		batchId: crypto.randomUUID(),
		digest: await digest(senderId, input, recipients),
		createdAt: Date.now(),
		recipients: recipients.length,
		scopeLabel:
			input.scope === 'user'
				? `${recipients[0].display_name}（@${recipients[0].username} · #${recipients[0].id}）`
				: input.scope === 'admins'
					? '全部启用管理员'
					: '全部启用用户',
		title: input.title,
		content: input.content,
		type: input.type
	};
}
export function messageProof(
	value: unknown
): Pick<MessagePreview, 'batchId' | 'digest' | 'createdAt'> {
	if (!value || typeof value !== 'object')
		throw new AdminWriteError('请先预览消息并核对接收范围。');
	const p = value as Record<string, unknown>;
	if (
		typeof p.batchId !== 'string' ||
		!/^[-a-f0-9]{36}$/.test(p.batchId) ||
		typeof p.digest !== 'string' ||
		!/^[a-f0-9]{64}$/.test(p.digest) ||
		typeof p.createdAt !== 'number' ||
		!Number.isFinite(p.createdAt)
	)
		throw new AdminWriteError('预览信息无效，请重新检查。');
	return { batchId: p.batchId, digest: p.digest, createdAt: p.createdAt };
}
export async function sendAdminMessage(
	database: Database,
	senderId: number | null,
	input: AdminMessageInput,
	proof: unknown
) {
	const p = messageProof(proof),
		storage = await batchStorage(database),
		key = storage.key();
	// A receipt stays present after withdrawal; a lost reply can be reconciled safely.
	const receipt = (
		await database
			.prepare(
				`SELECT sender_id,json_extract(${messageJson()},'$.dispatchDigest') digest FROM messages m WHERE ${key}=? LIMIT 1`
			)
			.bind(p.batchId)
			.all<{ sender_id: number | null; digest: string }>()
	).results[0];
	if (receipt) {
		if (receipt.sender_id !== senderId || receipt.digest !== p.digest)
			throw new AdminWriteError('批次校验失败。', undefined, 409);
		return { ...(await getMessageBatch(database, p.batchId))!, repeated: true };
	}
	if (p.createdAt > Date.now() + 60000 || Date.now() - p.createdAt > 15 * 60 * 1000)
		throw new AdminWriteError('预览已过期，请重新核对。', undefined, 409);
	const recipients = await resolveRecipients(database, input);
	if ((await digest(senderId, input, recipients)) !== p.digest)
		throw new AdminWriteError('消息内容或接收账号已变化，请重新预览。', undefined, 409);
	const { where, values } = audience(input);
	try {
		await database
			.prepare(
				`INSERT INTO messages(user_id,sender_id,type,title,content,${storage.hasColumn ? 'batch_id,' : ''}data_json,is_read)
 SELECT id,?,?,?,?,${storage.hasColumn ? '?,' : ''}json_object('dispatchBatchId',?,'dispatchDigest',?,'recipientCount',?),0 FROM users WHERE ${where}
 AND NOT EXISTS(SELECT 1 FROM messages m WHERE ${key}=?)
 AND CASE WHEN (SELECT json_group_array(json_array(id,username,display_name,role)) FROM (SELECT id,username,display_name,role FROM users WHERE ${where} ORDER BY id))=? THEN 1 ELSE json('MESSAGE_RECIPIENTS_CHANGED') END`
			)
			.bind(
				senderId,
				input.type,
				input.title,
				input.content,
				...(storage.hasColumn ? [p.batchId] : []),
				p.batchId,
				p.digest,
				recipients.length,
				...values,
				p.batchId,
				...values,
				state(recipients)
			)
			.all();
	} catch (error) {
		if (error instanceof Error && /malformed JSON|MESSAGE_RECIPIENTS_CHANGED/i.test(error.message))
			throw new AdminWriteError('接收账号已变化，请重新预览。', undefined, 409);
		throw error;
	}
	const result = await getMessageBatch(database, p.batchId);
	if (!result)
		throw new AdminWriteError('接收范围已变化或批次结果不可用，请重新核对。', undefined, 409);
	return { ...result, repeated: false };
}
export async function withdrawMessageBatch(database: Database, batchId: string) {
	const key = (await batchStorage(database)).key('messages');
	const trimmed = batchId.trim();
	if (!trimmed) throw new AdminWriteError('批次无效。');
	const exists = await getMessageBatch(database, trimmed);
	if (!exists) throw new AdminWriteError('该批次不存在。', undefined, 404);
	await database
		.prepare(
			`UPDATE messages SET content=NULL,data_json=json_set(${messageJson('messages')},'$.withdrawnAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE ${key}=? AND ${visibleMessage('messages')}`
		)
		.bind(trimmed)
		.all();
	return exists.recipients;
}
