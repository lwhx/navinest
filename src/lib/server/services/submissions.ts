import type { Database } from '$lib/server/db';
import { validateExternalTarget } from '$lib/server/safe-target';

const TYPES = new Set(['site', 'post', 'app', 'book']);
export type SubmissionInput = {
	type: string;
	title: string;
	summary: string | null;
	content: string | null;
	url: string | null;
};
export class SubmissionError extends Error {
	constructor(
		message: string,
		public readonly field?: string
	) {
		super(message);
		this.name = 'SubmissionError';
	}
}
type Row = {
	id: number;
	type: string;
	title: string;
	payload_json: string;
	status: string;
	review_message: string | null;
	created_at: string;
	updated_at: string;
};
function optional(value: string | null, max: number, field: string) {
	const normalized = value?.trim() || null;
	if (normalized && normalized.length > max) throw new SubmissionError(`${field}内容过长。`, field);
	return normalized;
}
function normalize(input: SubmissionInput) {
	if (!TYPES.has(input.type)) throw new SubmissionError('投稿类型无效。', 'type');
	const title = input.title.trim();
	if (!title) throw new SubmissionError('标题不能为空。', 'title');
	if (title.length > 160) throw new SubmissionError('标题不能超过 160 个字符。', 'title');
	const summary = optional(input.summary, 500, 'summary'),
		content = optional(input.content, 20_000, 'content');
	let url = optional(input.url, 2_048, 'url');
	if ((input.type === 'site' || input.type === 'app') && !url)
		throw new SubmissionError('该投稿类型必须填写目标网址。', 'url');
	if (url) {
		const result = validateExternalTarget(url);
		if (!result.valid) throw new SubmissionError(result.reason, 'url');
		url = result.target;
	}
	return { type: input.type, title, payload: { summary, content, url } };
}
export async function createSubmission(database: Database, userId: number, input: SubmissionInput) {
	const data = normalize(input);
	const row = (
		await database
			.prepare(
				"INSERT INTO submissions(user_id,target_item_id,type,title,payload_json,status) VALUES(?,NULL,?,?,?,'pending') RETURNING id"
			)
			.bind(userId, data.type, data.title, JSON.stringify(data.payload))
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new SubmissionError('投稿创建失败。');
	return row.id;
}
export async function listUserSubmissions(database: Database, userId: number) {
	const rows = (
		await database
			.prepare(
				'SELECT id,type,title,payload_json,status,review_message,created_at,updated_at FROM submissions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100'
			)
			.bind(userId)
			.all<Row>()
	).results;
	return rows.map((row) => ({
		id: row.id,
		type: row.type,
		title: row.title,
		payload: JSON.parse(row.payload_json) as {
			summary: string | null;
			content: string | null;
			url: string | null;
		},
		status: row.status,
		reviewMessage: row.review_message,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	}));
}
