import type { Database } from '$lib/server/db';
import { validateExternalTarget } from '$lib/server/safe-target';
import type { WebSnapshot } from '$lib/server/services/web-enrichment';

const TYPES = new Set(['site', 'post', 'app', 'book']);
export type SubmissionInput = {
	type: string;
	title: string;
	summary: string | null;
	content: string | null;
	url: string | null;
	userCategoryId?: number | null;
	iconFileId?: number | null;
	iconSource?: 'auto' | 'manual' | null;
	tagNames?: string[];
	webSnapshot?: WebSnapshot | null;
	aiSuggestion?: {
		title: string;
		summary: string;
		content: string;
		tags: string[];
		provider: string;
		model: string;
		generatedAt: string;
		categoryId?: number | null;
		categoryName?: string | null;
		categoryReason?: string;
	} | null;
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
function tags(values: string[] | undefined) {
	const result: string[] = [];
	for (const value of values ?? []) {
		const tag = String(value).trim().slice(0, 24);
		if (tag && !result.includes(tag)) result.push(tag);
		if (result.length >= 8) break;
	}
	return result;
}
function snapshot(value: WebSnapshot | null | undefined): WebSnapshot | null {
	if (!value) return null;
	const target = validateExternalTarget(String(value.fetchedUrl ?? ''));
	if (!target.valid) throw new SubmissionError('网页快照地址无效。', 'url');
	return {
		fetchedUrl: target.target,
		title: String(value.title ?? '')
			.trim()
			.slice(0, 500),
		description: String(value.description ?? '')
			.trim()
			.slice(0, 1000),
		excerpt: String(value.excerpt ?? '')
			.trim()
			.slice(0, 30_000),
		siteName: String(value.siteName ?? '')
			.trim()
			.slice(0, 200),
		iconUrl:
			String(value.iconUrl ?? '')
				.trim()
				.slice(0, 2048) || undefined,
		fetchedAt: String(value.fetchedAt ?? '')
			.trim()
			.slice(0, 40)
	};
}
function ai(value: SubmissionInput['aiSuggestion']) {
	if (!value) return null;
	return {
		title: String(value.title ?? '')
			.trim()
			.slice(0, 60),
		summary: String(value.summary ?? '')
			.trim()
			.slice(0, 300),
		content: String(value.content ?? '')
			.trim()
			.slice(0, 2000),
		tags: tags(value.tags),
		provider: String(value.provider ?? '')
			.trim()
			.slice(0, 80),
		model: String(value.model ?? '')
			.trim()
			.slice(0, 120),
		generatedAt: String(value.generatedAt ?? '')
			.trim()
			.slice(0, 40),
		categoryId:
			Number.isInteger(Number(value.categoryId)) && Number(value.categoryId) > 0
				? Number(value.categoryId)
				: null,
		categoryName:
			String(value.categoryName ?? '')
				.trim()
				.slice(0, 80) || null,
		categoryReason: String(value.categoryReason ?? '')
			.trim()
			.slice(0, 200)
	};
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
	return {
		type: input.type,
		title,
		payload: {
			summary,
			content,
			url,
			userCategoryId:
				Number.isInteger(Number(input.userCategoryId)) && Number(input.userCategoryId) > 0
					? Number(input.userCategoryId)
					: null,
			iconFileId:
				Number.isInteger(Number(input.iconFileId)) && Number(input.iconFileId) > 0
					? Number(input.iconFileId)
					: null,
			iconSource:
				input.iconSource === 'auto' || input.iconSource === 'manual' ? input.iconSource : null,
			tagNames: tags(input.tagNames),
			webSnapshot: snapshot(input.webSnapshot),
			aiSuggestion: ai(input.aiSuggestion)
		}
	};
}
export async function createSubmission(database: Database, userId: number, input: SubmissionInput) {
	const data = normalize(input);
	if (data.payload.userCategoryId) {
		const category = (
			await database
				.prepare('SELECT id FROM categories WHERE id=? AND type=? AND is_visible=1 LIMIT 1')
				.bind(data.payload.userCategoryId, data.type)
				.all<{ id: number }>()
		).results[0];
		if (!category)
			throw new SubmissionError('分类不存在、不可见或内容类型不一致。', 'userCategoryId');
	}
	if (data.payload.iconFileId) {
		const icon = (
			await database
				.prepare(
					"SELECT id FROM files WHERE id=? AND user_id=? AND bucket='FILES' AND mime_type LIKE 'image/%' LIMIT 1"
				)
				.bind(data.payload.iconFileId, userId)
				.all<{ id: number }>()
		).results[0];
		if (!icon) throw new SubmissionError('图标不存在、不是图片或不属于当前用户。', 'iconFileId');
	}
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
			userCategoryId?: number | null;
			iconFileId?: number | null;
			iconSource?: 'auto' | 'manual' | null;
			tagNames?: string[];
			webSnapshot?: WebSnapshot | null;
			aiSuggestion?: SubmissionInput['aiSuggestion'];
		},
		status: row.status,
		reviewMessage: row.review_message,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	}));
}
