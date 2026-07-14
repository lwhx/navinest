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
	| { decision: 'approve'; message: string; item: ItemInput; newTagNames?: string[] };
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
	await validateSubmissionIcon(database, submission.user_id, input.item.iconFileId);
	const names = normalizeTagNames(input.newTagNames),
		resolved = await resolveTagIds(database, input.item.type, input.item.tagIds, names),
		publishInput: ItemInput = {
			...input.item,
			tagIds: resolved.ids,
			status: 'published',
			visibility: 'public'
		};
	let itemId: number;
	try {
		itemId = await createItem(database, publishInput, reviewerId);
	} catch (error) {
		await cleanupCreatedTags(database, resolved.created);
		throw error;
	}
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
		await cleanupCreatedTags(database, resolved.created);
		throw error;
	}
	return { status: 'published' as const, itemId };
}
