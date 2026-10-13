import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseValue } from '$lib/server/db';
import { getAdminSubmission, loadSubmissionQueue, userSubmissionLinks } from './admin-submissions';
import { performReviewRequest, reviewRequestError } from './submission-review-request';
import { cancelUnstartedReview, claimSubmissionReview } from './submission-review';
import { submissionQueueFilters, submissionQueueUrl } from '$lib/submission-queue';

const connections: DatabaseSync[] = [];
function fixture(count = 1) {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	for (const name of ['0001_initial', '0015_submission_review_lease'])
		sqlite.exec(readFileSync(`migrations/${name}.sql`, 'utf8'));
	sqlite.exec(
		"INSERT INTO users(id,username,display_name,role) VALUES(1,'admin','审核管理员','admin'),(2,'author','投稿作者','user'),(3,'other','另一位作者','user');"
	);
	const insert = sqlite.prepare(
		"INSERT INTO submissions(user_id,type,title,payload_json,created_at) VALUES(2,'site',?,?,?)"
	);
	for (let id = 1; id <= count; id++)
		insert.run(
			'投稿 ' + id,
			JSON.stringify({ summary: '简介', url: `https://example.com/${id}` }),
			'2026-10-14 01:00:00'
		);
	const database: Database = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement = {
				bind(...next: DatabaseValue[]) {
					values = next;
					return statement;
				},
				async all<T>() {
					return {
						results: sqlite
							.prepare(query)
							.all(...values.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v))) as T[]
					};
				}
			};
			return statement;
		}
	};
	return { sqlite, database };
}
afterEach(() => connections.splice(0).forEach((db) => db.close()));
const item = {
	type: 'site',
	categoryId: null,
	iconFileId: null,
	coverFileId: null,
	title: '发布后的标题',
	slug: 'published-resource',
	summary: '编辑后的简介',
	content: '',
	status: 'published',
	visibility: 'public',
	sortOrder: 0,
	isFeatured: false,
	tagIds: [],
	meta: { site_url: 'https://example.com/' }
};
const key = 'review-request-00000001',
	second = 'review-request-00000002';
const approve = { decision: 'approve', message: '通过', item, requestKey: key, previousKey: '' };

function lostDatabaseReply(database: Database, matches: (query: string) => boolean): Database {
	let lost = false;
	return {
		prepare(query) {
			const inner = database.prepare(query);
			const outer = {
				bind(...values: DatabaseValue[]) {
					inner.bind(...values);
					return outer;
				},
				async all<T>() {
					const result = await inner.all<T>();
					if (!lost && matches(query)) {
						lost = true;
						throw new Error('database reply lost after commit');
					}
					return result;
				}
			};
			return outer;
		}
	};
}

describe('submission review queue and recovery', () => {
	it('keeps uncertain item INSERT replies locked instead of allowing another publication', async () => {
		const { sqlite, database } = fixture();
		const failing = lostDatabaseReply(database, (query) => query.includes('INSERT INTO items'));
		await expect(performReviewRequest(failing, 1, 1, approve)).rejects.toThrow('reply lost');
		const state = await getAdminSubmission(database, 1);
		expect(state?.processing).toBe(true);
		expect(state?.receipt?.state).toBe('running');
		expect(sqlite.prepare('SELECT COUNT(*) n FROM items').get()).toEqual({ n: 1 });
		await expect(
			performReviewRequest(database, 1, 1, { ...approve, requestKey: second, previousKey: key })
		).rejects.toMatchObject({ status: 409 });
	});
	it('does not claim or withdraw a pending record that already references content', async () => {
		const { sqlite, database } = fixture();
		sqlite.exec(
			"INSERT INTO items(id,type,title,slug) VALUES(1,'site','部分完成的内容','partial-resource'); UPDATE submissions SET target_item_id=1 WHERE id=1"
		);
		expect((await getAdminSubmission(database, 1))?.processing).toBe(true);
		await expect(performReviewRequest(database, 1, 1, approve)).rejects.toMatchObject({
			status: 409
		});
		await expect(
			cancelUnstartedReview(database, 1, { key, previousKey: '' })
		).rejects.toMatchObject({ status: 409 });
	});
	it('keeps already-finalized content when the final database reply is lost', async () => {
		const { sqlite, database } = fixture();
		const failing = lostDatabaseReply(database, (query) =>
			query.includes('UPDATE submissions SET review_token=NULL,review_started_at=NULL')
		);
		await expect(performReviewRequest(failing, 1, 1, approve)).rejects.toThrow('reply lost');
		const state = await getAdminSubmission(database, 1);
		expect(state?.status).toBe('published');
		expect(state?.receipt?.state).toBe('succeeded');
		expect(state?.publishedHref).toBe('/sites/published-resource');
		expect(sqlite.prepare('SELECT COUNT(*) total FROM items').get()).toEqual({ total: 1 });
		expect(sqlite.prepare('SELECT COUNT(*) total FROM messages').get()).toEqual({ total: 1 });
	});
	it('cleans a partially acknowledged notification before retrying a failed review', async () => {
		const { sqlite, database } = fixture();
		const failing = lostDatabaseReply(database, (query) => query.includes('INSERT INTO messages'));
		await expect(performReviewRequest(failing, 1, 1, approve)).rejects.toThrow('reply lost');
		expect((await getAdminSubmission(database, 1))?.receipt?.state).toBe('failed');
		expect(sqlite.prepare('SELECT COUNT(*) total FROM messages').get()).toEqual({ total: 0 });
		expect(sqlite.prepare('SELECT COUNT(*) total FROM items').get()).toEqual({ total: 0 });
		await performReviewRequest(database, 1, 1, {
			...approve,
			requestKey: second,
			previousKey: key
		});
		expect(sqlite.prepare('SELECT COUNT(*) total FROM messages').get()).toEqual({ total: 1 });
	});
	it('does not reuse a receipt key as its own predecessor', async () => {
		const { database } = fixture();
		await cancelUnstartedReview(database, 1, { key, previousKey: '' });
		await expect(
			performReviewRequest(database, 1, 1, { ...approve, previousKey: key })
		).rejects.toThrow('标识无效');
	});
	it('pages all 221 submissions with stable tie ordering and counts', async () => {
		const { database } = fixture(221);
		const pages = await Promise.all(
			[1, 2, 12, 999].map((page) =>
				loadSubmissionQueue(database, new URLSearchParams(`status=pending&page=${page}`))
			)
		);
		expect(pages.map((page) => page.submissions.length)).toEqual([20, 20, 1, 1]);
		expect(pages[1].submissions.map((row) => row.id)).toEqual(
			Array.from({ length: 20 }, (_, i) => i + 21)
		);
		expect(pages[3].filters.page).toBe(12);
		expect(pages[0].total).toBe(221);
		expect(pages[0].summary.pending).toBe(221);
	});
	it('filters on the server and treats LIKE and SQL punctuation as literal text', async () => {
		const { sqlite, database } = fixture(221);
		sqlite.prepare('UPDATE submissions SET title=? WHERE id=220').run("特殊 %_\\' 关键词");
		const result = await loadSubmissionQueue(
			database,
			new URLSearchParams({ q: "%_\\'", status: 'all' })
		);
		expect(result.total).toBe(1);
		expect(result.submissions[0].id).toBe(220);
		expect(
			(await loadSubmissionQueue(database, new URLSearchParams({ q: '不存在 OR 1=1' }))).total
		).toBe(0);
	});
	it('restores an explicitly selected record outside its page and calculates its matching page', async () => {
		const { database } = fixture(221);
		const data = await loadSubmissionQueue(
			database,
			new URLSearchParams('status=pending&page=2&submission=221')
		);
		expect(data.selected?.id).toBe(221);
		expect(data.selectedPage).toBe(12);
		expect(data.submissions[0].id).toBe(21);
		expect(
			(await loadSubmissionQueue(database, new URLSearchParams('status=rejected&submission=221')))
				.selectedUnavailable
		).toBe(true);
	});
	it('keeps reviewing records in the pending queue and does not expose the lease token', async () => {
		const { database } = fixture();
		await claimSubmissionReview(database, 1, 'private-lease-token', { key, previousKey: '' });
		const data = await loadSubmissionQueue(database, new URLSearchParams());
		expect(data.total).toBe(1);
		expect(data.selected?.processing).toBe(true);
		expect(JSON.stringify(data)).not.toContain('private-lease-token');
	});
	it('reports malformed historical payloads without breaking the queue', async () => {
		const { sqlite, database } = fixture();
		sqlite.exec("UPDATE submissions SET payload_json='broken' WHERE id=1");
		const data = await loadSubmissionQueue(database, new URLSearchParams('q=投稿'));
		expect(data.selected?.payloadAvailable).toBe(false);
		expect(data.total).toBe(1);
		await expect(performReviewRequest(database, 1, 1, approve)).rejects.toThrow('投稿数据无法读取');
	});
	it('records success durably and rejects the same mutation after a lost acknowledgement', async () => {
		const { sqlite, database } = fixture();
		await performReviewRequest(database, 1, 1, approve);
		const state = await getAdminSubmission(database, 1);
		expect(state?.receipt).toEqual({ key, state: 'succeeded' });
		expect(state?.processing).toBe(false);
		expect(state?.publishedHref).toBe('/sites/published-resource');
		await expect(performReviewRequest(database, 1, 1, approve)).rejects.toMatchObject({
			status: 409
		});
		expect(sqlite.prepare('SELECT COUNT(*) total FROM items').get()).toEqual({ total: 1 });
	});
	it('records rejection and prevents duplicate rejection notifications', async () => {
		const { sqlite, database } = fixture();
		const body = { decision: 'reject', message: '请补充资料', requestKey: key, previousKey: '' };
		await performReviewRequest(database, 1, 1, body);
		expect((await getAdminSubmission(database, 1))?.receipt?.state).toBe('succeeded');
		await expect(performReviewRequest(database, 1, 1, body)).rejects.toMatchObject({ status: 409 });
		expect(sqlite.prepare('SELECT COUNT(*) total FROM messages').get()).toEqual({ total: 1 });
	});
	it('allows cancellation to win before claim, then rejects delayed or replayed original requests', async () => {
		const { sqlite, database } = fixture();
		await cancelUnstartedReview(database, 1, { key, previousKey: '' });
		await expect(performReviewRequest(database, 1, 1, approve)).rejects.toMatchObject({
			status: 409
		});
		await performReviewRequest(database, 1, 1, {
			...approve,
			requestKey: second,
			previousKey: key
		});
		expect((await getAdminSubmission(database, 1))?.receipt?.key).toBe(second);
		expect(sqlite.prepare('SELECT COUNT(*) total FROM items').get()).toEqual({ total: 1 });
	});
	it('does not cancel or automatically steal a running request even after the old lease timeout', async () => {
		const { sqlite, database } = fixture();
		await claimSubmissionReview(database, 1, 'lease', { key, previousKey: '' });
		sqlite.exec("UPDATE submissions SET review_started_at='2000-01-01' WHERE id=1");
		await expect(
			cancelUnstartedReview(database, 1, { key: second, previousKey: key })
		).rejects.toMatchObject({ status: 409 });
		await expect(
			performReviewRequest(database, 1, 1, { ...approve, requestKey: second, previousKey: key })
		).rejects.toMatchObject({ status: 409 });
		expect((await getAdminSubmission(database, 1))?.receipt).toEqual({ key, state: 'running' });
	});
	it('stores a failed receipt only after cleanup, preserves the original payload and allows a new request', async () => {
		const { sqlite, database } = fixture();
		sqlite.exec(
			"INSERT INTO items(type,title,slug) VALUES('site','existing','published-resource')"
		);
		let failure: unknown;
		try {
			await performReviewRequest(database, 1, 1, approve);
		} catch (cause) {
			failure = cause;
		}
		expect(reviewRequestError(failure)).toMatchObject({
			status: 409,
			fields: { slug: expect.any(String) }
		});
		const state = await getAdminSubmission(database, 1);
		expect(state?.receipt?.state).toBe('failed');
		expect(state?.processing).toBe(false);
		expect(state?.payload.summary).toBe('简介');
		await expect(performReviewRequest(database, 1, 1, approve)).rejects.toMatchObject({
			status: 409
		});
		await performReviewRequest(database, 1, 1, {
			...approve,
			item: { ...item, slug: 'second-resource' },
			requestKey: second,
			previousKey: key
		});
		expect((await getAdminSubmission(database, 1))?.publishedHref).toBe('/sites/second-resource');
	});
	it('cannot mark an operation failed when rollback cleanup itself fails', async () => {
		const { sqlite, database } = fixture();
		sqlite.exec(
			"CREATE TRIGGER fail_review_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'message failed'); END; CREATE TRIGGER fail_cleanup BEFORE DELETE ON items BEGIN SELECT RAISE(ABORT,'cleanup failed'); END;"
		);
		await expect(performReviewRequest(database, 1, 1, approve)).rejects.toThrow('cleanup failed');
		const row = await getAdminSubmission(database, 1);
		expect(row?.status).toBe('pending');
		expect(row?.receipt?.state).toBe('running');
		expect(row?.processing).toBe(true);
		await expect(
			performReviewRequest(database, 1, 1, { ...approve, requestKey: second, previousKey: key })
		).rejects.toMatchObject({ status: 409 });
	});
	it('validates fields and submission type before claiming a review', async () => {
		const { database } = fixture();
		await expect(
			performReviewRequest(database, 1, 1, { ...approve, item: { ...item, type: 'post' } })
		).rejects.toMatchObject({ fields: { type: expect.any(String) } });
		await expect(
			performReviewRequest(database, 1, 1, { ...approve, item: { ...item, title: '' } })
		).rejects.toMatchObject({ fields: { title: expect.any(String) } });
		expect((await getAdminSubmission(database, 1))?.receipt).toBeNull();
	});
	it('only exposes published content links belonging to the requesting submitter', async () => {
		const { sqlite, database } = fixture(3);
		await performReviewRequest(database, 1, 1, approve);
		expect(await userSubmissionLinks(database, 2)).toEqual({ 1: '/sites/published-resource' });
		expect(await userSubmissionLinks(database, 3)).toEqual({});
		sqlite.exec("UPDATE items SET visibility='private' WHERE slug='published-resource'");
		expect(await userSubmissionLinks(database, 2)).toEqual({});
		expect((await getAdminSubmission(database, 1))?.publishedHref).toBeNull();
	});
	it('normalizes URL state and resets only explicitly changed pagination or selection', () => {
		const filters = submissionQueueFilters(
			new URLSearchParams('status=unknown&page=1e100&submission=-1&q=%20中文%20')
		);
		expect(filters).toEqual({ status: 'pending', q: '中文', page: 1, submission: null });
		expect(submissionQueueUrl({ ...filters, page: 3, submission: 221 })).toBe(
			'/admin/submissions?status=pending&q=%E4%B8%AD%E6%96%87&page=3&submission=221'
		);
		expect(
			submissionQueueUrl({ ...filters, page: 3, submission: 221 }, { page: 1, submission: null })
		).not.toContain('page=');
	});
});
