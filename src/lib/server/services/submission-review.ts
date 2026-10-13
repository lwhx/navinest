import type { Database } from '$lib/server/db';
import type { ItemInput } from '$lib/server/admin-validation';
import { createItem, deleteItem, AdminWriteError } from '$lib/server/services/admin-write';
import { createReviewMessage } from '$lib/server/services/user-messages';
import { validReviewKey, type ReviewAttempt } from '$lib/submission-queue';

export class SubmissionReviewError extends Error {
	constructor(
		message: string,
		public readonly status: 400 | 404 | 409 = 400
	) {
		super(message);
		this.name = 'SubmissionReviewError';
	}
}
export type ReviewInput =
	| { decision: 'reject'; message: string }
	| { decision: 'approve'; message: string; item: ItemInput; newTagNames?: string[] };
export async function claimSubmissionReview(
	database: Database,
	id: number,
	token: string,
	attempt?: ReviewAttempt
) {
	if (
		attempt &&
		(attempt.key === attempt.previousKey ||
			!validReviewKey(attempt.key) ||
			(attempt.previousKey !== '' && !validReviewKey(attempt.previousKey)))
	)
		throw new SubmissionReviewError('审核请求标识无效，请刷新页面。');
	const payload = "CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END";
	const row = (
		await database
			.prepare(
				`UPDATE submissions SET status='reviewing',review_token=?,review_started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
				 ${attempt ? ",payload_json=json_set(payload_json,'$._review',json_object('key',?,'state','running'))" : ''}
				 WHERE id=? AND ((status='pending' ${attempt ? 'AND review_token IS NULL AND target_item_id IS NULL' : ''}) OR (status='reviewing' AND review_started_at<datetime('now','-10 minutes')))
				 ${attempt ? `AND json_valid(payload_json) AND COALESCE(json_extract(${payload},'$._review.key'),'')=? AND COALESCE(json_extract(${payload},'$._review.state'),'')<>'running'` : ''}
				 RETURNING id,user_id,title,type`
			)
			.bind(token, ...(attempt ? [attempt.key] : []), id, ...(attempt ? [attempt.previousKey] : []))
			.all<{ id: number; user_id: number; title: string; type: string }>()
	).results[0];
	if (row) return row;
	const exists = (
		await database
			.prepare('SELECT status FROM submissions WHERE id=? LIMIT 1')
			.bind(id)
			.all<{ status: string }>()
	).results[0];
	throw new SubmissionReviewError(
		exists ? '投稿正在审核或已经处理，不能重复审核。' : '投稿不存在。',
		exists ? 409 : 404
	);
}

async function markFailedAttempt(database: Database, id: number, attempt?: ReviewAttempt) {
	if (!attempt) return;
	await database
		.prepare(
			"UPDATE submissions SET payload_json=json_set(payload_json,'$._review.state','failed') WHERE id=? AND status='pending' AND review_token IS NULL AND json_extract(payload_json,'$._review.key')=?"
		)
		.bind(id, attempt.key)
		.all();
}

async function cleanupReviewMessage(database: Database, id: number, attempt?: ReviewAttempt) {
	if (!attempt) return;
	const payload = "CASE WHEN json_valid(data_json) THEN data_json ELSE '{}' END";
	await database
		.prepare(
			`DELETE FROM messages WHERE type='submission_review' AND json_extract(${payload},'$.submissionId')=? AND json_extract(${payload},'$.reviewKey')=?`
		)
		.bind(id, attempt.key)
		.all();
}

export async function cancelUnstartedReview(
	database: Database,
	id: number,
	attempt: ReviewAttempt
) {
	if (
		attempt.key === attempt.previousKey ||
		!validReviewKey(attempt.key) ||
		(attempt.previousKey !== '' && !validReviewKey(attempt.previousKey))
	)
		throw new SubmissionReviewError('审核请求标识无效。');
	const payload = "CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END";
	const row = (
		await database
			.prepare(
				`UPDATE submissions SET payload_json=json_set(payload_json,'$._review',json_object('key',?,'state','failed')),updated_at=CURRENT_TIMESTAMP
		WHERE id=? AND status='pending' AND review_token IS NULL AND target_item_id IS NULL AND json_valid(payload_json)
		AND COALESCE(json_extract(${payload},'$._review.key'),'')=? AND COALESCE(json_extract(${payload},'$._review.state'),'')<>'running' RETURNING id`
			)
			.bind(attempt.key, id, attempt.previousKey)
			.all<{ id: number }>()
	).results[0];
	if (!row)
		throw new SubmissionReviewError(
			'请求已开始或状态已改变，请重新核对；未撤销正在执行的审核。',
			409
		);
	return { status: 'cancelled' as const };
}

function normalizeTagNames(values: string[] | undefined) {
	const names: string[] = [];
	for (const value of values ?? []) {
		const name = String(value).trim();
		if (!name || names.some((entry) => entry.toLocaleLowerCase() === name.toLocaleLowerCase()))
			continue;
		if (name.length > 24) throw new SubmissionReviewError('新标签名称不能超过 24 个字符。');
		names.push(name);
	}
	if (names.length > 8) throw new SubmissionReviewError('每次审核最多创建 8 个新标签。');
	return names;
}

function tagSlug(name: string) {
	const ascii = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60);
	if (ascii) return ascii;
	let hash = 2166136261;
	for (const byte of new TextEncoder().encode(name)) {
		hash ^= byte;
		hash = Math.imul(hash, 16777619);
	}
	return `tag-${(hash >>> 0).toString(36)}`;
}

async function validateSubmissionIcon(
	database: Database,
	userId: number,
	iconFileId: number | null
) {
	if (!iconFileId) return;
	const row = (
		await database
			.prepare(
				"SELECT id FROM files WHERE id=? AND user_id=? AND bucket='FILES' AND mime_type LIKE 'image/%' LIMIT 1"
			)
			.bind(iconFileId, userId)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new SubmissionReviewError('投稿图标不存在、不是图片或不属于投稿用户。');
}

async function resolveTagIds(
	database: Database,
	type: ItemInput['type'],
	existingIds: number[],
	names: string[]
) {
	const ids = new Set(existingIds),
		created: number[] = [];
	try {
		for (const name of names) {
			const existing = (
				await database
					.prepare('SELECT id FROM tags WHERE type=? AND lower(name)=lower(?) LIMIT 1')
					.bind(type, name)
					.all<{ id: number }>()
			).results[0];
			if (existing) {
				ids.add(existing.id);
				continue;
			}
			const base = tagSlug(name);
			let slug = base,
				suffix = 2;
			while (
				(
					await database
						.prepare('SELECT id FROM tags WHERE type=? AND slug=? LIMIT 1')
						.bind(type, slug)
						.all<{ id: number }>()
				).results[0]
			)
				slug = `${base.slice(0, 56)}-${suffix++}`;
			const row = (
				await database
					.prepare('INSERT INTO tags(type,name,slug,description) VALUES(?,?,?,NULL) RETURNING id')
					.bind(type, name, slug)
					.all<{ id: number }>()
			).results[0];
			if (!row) throw new SubmissionReviewError('新标签创建失败。');
			ids.add(row.id);
			created.push(row.id);
		}
	} catch (error) {
		await cleanupCreatedTags(database, created);
		throw error;
	}
	return { ids: [...ids], created };
}

async function cleanupCreatedTags(database: Database, ids: number[]) {
	for (const id of ids)
		await database
			.prepare('DELETE FROM tags WHERE id=? AND NOT EXISTS(SELECT 1 FROM item_tags WHERE tag_id=?)')
			.bind(id, id)
			.all();
}

export async function reviewSubmission(
	database: Database,
	submissionId: number,
	reviewerId: number,
	input: ReviewInput,
	attempt?: ReviewAttempt
) {
	const message = input.message.trim();
	if (input.decision === 'reject' && !message)
		throw new SubmissionReviewError('拒绝投稿时必须填写审核意见。');
	const token = crypto.randomUUID(),
		submission = await claimSubmissionReview(database, submissionId, token, attempt);
	if (input.decision === 'reject') {
		const row = (
			await database
				.prepare(
					"UPDATE submissions SET status='rejected',reviewer_id=?,review_message=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='reviewing' AND review_token=? RETURNING id"
				)
				.bind(reviewerId, message, submissionId, token)
				.all<{ id: number }>()
		).results[0];
		if (!row) throw new SubmissionReviewError('投稿已经审核，不能重复处理。', 409);
		try {
			await createReviewMessage(database, {
				userId: submission.user_id,
				senderId: reviewerId,
				submissionId,
				submissionTitle: submission.title,
				reviewKey: attempt?.key,
				status: 'rejected',
				content: message,
				item: null
			});
		} catch (error) {
			const reverted = (
				await database
					.prepare(
						"UPDATE submissions SET status='pending',review_token=NULL,review_started_at=NULL,reviewer_id=NULL,review_message=NULL,reviewed_at=NULL WHERE id=? AND status='rejected' AND review_token=? RETURNING id"
					)
					.bind(submissionId, token)
					.all<{ id: number }>()
			).results[0];
			if (reverted) {
				await cleanupReviewMessage(database, submissionId, attempt);
				await markFailedAttempt(database, submissionId, attempt);
			}
			throw error;
		}
		await database
			.prepare(
				`UPDATE submissions SET review_token=NULL,review_started_at=NULL ${attempt ? ",payload_json=json_set(payload_json,'$._review.state','succeeded')" : ''} WHERE id=? AND status='rejected' AND review_token=?`
			)
			.bind(submissionId, token)
			.all();
		return { status: 'rejected' as const, itemId: null };
	}
	let itemId: number | null = null,
		createdTags: number[] = [];
	try {
		if (input.item.type !== submission.type)
			throw new SubmissionReviewError('发布内容类型必须与投稿一致。');
		await validateSubmissionIcon(database, submission.user_id, input.item.iconFileId);
		const names = normalizeTagNames(input.newTagNames),
			resolved = await resolveTagIds(database, input.item.type, input.item.tagIds, names),
			publishInput: ItemInput = {
				...input.item,
				tagIds: resolved.ids,
				status: 'published',
				visibility: 'public'
			};
		createdTags = resolved.created;
		itemId = await createItem(database, publishInput, reviewerId);
		const row = (
			await database
				.prepare(
					"UPDATE submissions SET status='published',target_item_id=?,reviewer_id=?,review_message=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='reviewing' AND review_token=? RETURNING id"
				)
				.bind(itemId, reviewerId, message || null, submissionId, token)
				.all<{ id: number }>()
		).results[0];
		if (!row) throw new SubmissionReviewError('投稿正在审核或已经处理，不能重复审核。', 409);
		await createReviewMessage(database, {
			userId: submission.user_id,
			senderId: reviewerId,
			submissionId,
			submissionTitle: submission.title,
			reviewKey: attempt?.key,
			status: 'published',
			content: message || '投稿已通过审核并发布。',
			item: { id: itemId, type: publishInput.type, slug: publishInput.slug }
		});
		await database
			.prepare(
				`UPDATE submissions SET review_token=NULL,review_started_at=NULL ${attempt ? ",payload_json=json_set(payload_json,'$._review.state','succeeded')" : ''} WHERE id=? AND status='published' AND review_token=?`
			)
			.bind(submissionId, token)
			.all();
		return { status: 'published' as const, itemId };
	} catch (error) {
		const reverted = (
			await database
				.prepare(
					"UPDATE submissions SET status='pending',target_item_id=NULL,review_token=NULL,review_started_at=NULL,reviewer_id=NULL,review_message=NULL,reviewed_at=NULL WHERE id=? AND status IN ('reviewing','published') AND review_token=? RETURNING id"
				)
				.bind(submissionId, token)
				.all<{ id: number }>()
		).results[0];
		if (reverted) {
			await cleanupReviewMessage(database, submissionId, attempt);
			if (itemId !== null) await deleteItem(database, itemId);
			await cleanupCreatedTags(database, createdTags);
			// A missing INSERT reply may hide a committed item/tag whose id we never received.
			// Only known validation failures or cleanup of an identified item permit a new attempt.
			if (
				itemId !== null ||
				error instanceof AdminWriteError ||
				error instanceof SubmissionReviewError ||
				(error instanceof Error &&
					/UNIQUE constraint failed:\s*items\.(?:type,\s*items\.)?slug/i.test(error.message))
			)
				await markFailedAttempt(database, submissionId, attempt);
		}
		throw error;
	}
}
