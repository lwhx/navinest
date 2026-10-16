import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseValue } from '$lib/server/db';
import { createSubmission } from './submissions';
import { getUserSubmission, loadResubmission, loadUserSubmissions } from './user-submissions';
import { submissionId, userSubmissionFilters, userSubmissionUrl } from '$lib/user-submissions';
const connections: DatabaseSync[] = [];
function fixture(count = 0) {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	for (const name of ['0001_initial', '0015_submission_review_lease'])
		sqlite.exec(readFileSync(`migrations/${name}.sql`, 'utf8'));
	sqlite.exec(
		"INSERT INTO users(id,username,display_name) VALUES(1,'author','作者'),(2,'other','其他作者'); INSERT INTO categories(id,type,name,slug) VALUES(1,'site','开发工具','tools'),(2,'post','文章','posts'); INSERT INTO categories(id,type,parent_id,name,slug) VALUES(3,'site',1,'代码','code')"
	);
	const insert = sqlite.prepare(
		"INSERT INTO submissions(user_id,type,title,payload_json,status,created_at) VALUES(1,'site',?,?,'pending','2026-10-16 01:00:00')"
	);
	for (let i = 1; i <= count; i++)
		insert.run(
			'投稿 ' + i,
			JSON.stringify({ summary: '简介', url: `https://example.com/${i}`, content: '正文' })
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
const input = {
	type: 'site',
	title: '修改后的标题',
	summary: '简介',
	content: '补充',
	url: 'https://example.com/revised',
	sourceSubmissionId: 1
};
describe('owned submission history and revisions', () => {
	it('normalizes filters and preserves literal search values and selected detail in links', () => {
		const filters = userSubmissionFilters(
			new URLSearchParams('status=__proto__&q=%20all%25_%20&page=9007199254740992&submission=-1')
		);
		expect(filters).toEqual({ q: 'all%_', status: 'all', page: 1, submission: null });
		expect(userSubmissionUrl(filters, { page: 2, submission: 7 })).toBe(
			'/user/submissions?q=all%25_&page=2&submission=7#submission-detail'
		);
		expect(submissionId('NaN')).toBeNull();
	});
	it('counts and paginates all owned rows, clamps the last page and searches beyond 100', async () => {
		const { database, sqlite } = fixture(225);
		sqlite.exec(
			"INSERT INTO submissions(user_id,type,title,payload_json) VALUES(2,'site','不属于当前作者','{}')"
		);
		const first = await loadUserSubmissions(database, 1, new URLSearchParams());
		expect(first.total).toBe(225);
		expect(first.pageCount).toBe(12);
		expect(first.submissions).toHaveLength(20);
		expect(first.submissions[0].id).toBe(225);
		const last = await loadUserSubmissions(database, 1, new URLSearchParams('page=99999'));
		expect(last.filters.page).toBe(12);
		expect(last.submissions.map((r) => r.id)).toEqual([5, 4, 3, 2, 1]);
		expect(
			(await loadUserSubmissions(database, 1, new URLSearchParams('q=https://example.com/1'))).total
		).toBe(111);
	});
	it('uses literal search across body and feedback, and keeps pending inclusive of reviewing', async () => {
		const { database, sqlite } = fixture(4);
		sqlite.exec(
			`UPDATE submissions SET status='reviewing' WHERE id=2; UPDATE submissions SET status='rejected',review_message='请补充100%_说明' WHERE id=3; UPDATE submissions SET payload_json='{"content":"独有正文"}',status='published' WHERE id=4`
		);
		expect(
			(
				await loadUserSubmissions(database, 1, new URLSearchParams('status=pending'))
			).submissions.map((r) => r.id)
		).toEqual([2, 1]);
		expect(
			(await loadUserSubmissions(database, 1, new URLSearchParams('q=100%25_'))).submissions.map(
				(r) => r.id
			)
		).toEqual([3]);
		expect(
			(await loadUserSubmissions(database, 1, new URLSearchParams('q=独有正文'))).submissions.map(
				(r) => r.id
			)
		).toEqual([4]);
	});
	it('contains bad JSON and projects only user content without review internals', async () => {
		const { database, sqlite } = fixture(4);
		sqlite.exec(
			`UPDATE submissions SET payload_json='broken',status='rejected' WHERE id=1; UPDATE submissions SET payload_json='[]' WHERE id=2; UPDATE submissions SET payload_json='{"content":{"bad":1},"summary":[],"tagNames":["正常",7,"正常"],"_review":{"key":"secret","state":"failed"},"aiSuggestion":{"provider":"private"}}' WHERE id=3`
		);
		const result = await loadUserSubmissions(database, 1, new URLSearchParams('submission=3'));
		expect(result.submissions[3].payloadAvailable).toBe(false);
		expect(result.submissions[3].canResubmit).toBe(false);
		expect(result.selected?.tagNames).toEqual(['正常']);
		expect(result.selected?.content).toBe('');
		expect(JSON.stringify(result)).not.toMatch(
			/secret|private|payload_json|review_token|aiSuggestion/
		);
		expect(await getUserSubmission(database, 2, 3)).toBeNull();
		expect(
			(await loadUserSubmissions(database, 2, new URLSearchParams('submission=3')))
				.selectedUnavailable
		).toBe(true);
	});
	it('keeps full detail off-page and links only real public published same-type content', async () => {
		const { database, sqlite } = fixture(225);
		sqlite.exec(
			"INSERT INTO items(id,type,title,slug,status,visibility) VALUES(1,'site','公开发布','public','published','public'); UPDATE submissions SET status='published',target_item_id=1 WHERE id=1"
		);
		const result = await loadUserSubmissions(database, 1, new URLSearchParams('submission=1'));
		expect(result.selected?.publishedHref).toBe('/sites/public');
		expect(result.selected?.content).toBe('正文');
		expect(result.submissions.some((r) => r.id === 1)).toBe(false);
		for (const change of [
			"UPDATE items SET visibility='private'",
			"UPDATE items SET visibility='public',status='draft'",
			"UPDATE items SET status='published',type='post'",
			"UPDATE items SET type='site'; UPDATE submissions SET review_token='busy' WHERE id=1"
		]) {
			sqlite.exec(change);
			expect((await getUserSubmission(database, 1, 1))?.publishedHref).toBeNull();
		}
	});
	it('restores category path and owned image, and clears unavailable references for revisions', async () => {
		const { database, sqlite } = fixture(1);
		sqlite.exec(
			`INSERT INTO files(id,user_id,bucket,object_key,mime_type) VALUES(1,1,'FILES','icon','image/png'); UPDATE submissions SET status='rejected',payload_json='{"userCategoryId":3,"iconFileId":1,"iconSource":"manual","tagNames":["开发"]}' WHERE id=1`
		);
		let restored = await loadResubmission(database, 1, 1);
		expect(restored?.source.categoryPath).toBe('开发工具 / 代码');
		expect(restored?.draft).toMatchObject({
			userCategoryId: '3',
			iconFileId: '1',
			iconSource: 'manual',
			tagInput: '开发'
		});
		sqlite.exec('UPDATE categories SET is_visible=0 WHERE id=1; UPDATE files SET user_id=2');
		restored = await loadResubmission(database, 1, 1);
		expect(restored?.draft).toMatchObject({ userCategoryId: '', iconFileId: '' });
	});
	it('appends one revision without altering the original, and allows the rejected child to be revised', async () => {
		const { database, sqlite } = fixture(1);
		sqlite.exec("UPDATE submissions SET status='rejected',review_message='请补充' WHERE id=1");
		const original = sqlite.prepare('SELECT * FROM submissions WHERE id=1').get();
		const outcomes = await Promise.allSettled([
			createSubmission(database, 1, input),
			createSubmission(database, 1, input)
		]);
		expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(sqlite.prepare('SELECT * FROM submissions WHERE id=1').get()).toEqual(original);
		expect(await getUserSubmission(database, 1, 1)).toMatchObject({
			canResubmit: false,
			childId: 2
		});
		expect(await getUserSubmission(database, 1, 2)).toMatchObject({
			parentId: 1,
			status: 'pending'
		});
		expect((await loadResubmission(database, 1, 1))?.draft).toBeNull();
		sqlite.exec("UPDATE submissions SET status='rejected' WHERE id=2");
		expect(await createSubmission(database, 1, { ...input, sourceSubmissionId: 2 })).toBe(3);
	});
	it('refuses forged, other-user, legacy, active, damaged and already published sources', async () => {
		const { database, sqlite } = fixture(1);
		for (const state of [
			"status='pending'",
			"status='reviewing'",
			"status='published'",
			"status='rejected',type='book'",
			"type='site',status='rejected',review_token='busy'",
			"review_token=NULL,payload_json='broken'",
			"payload_json='{}',user_id=2"
		]) {
			sqlite.exec('UPDATE submissions SET ' + state + ' WHERE id=1');
			await expect(createSubmission(database, 1, input)).rejects.toMatchObject({
				field: 'sourceSubmissionId'
			});
		}
		await expect(
			createSubmission(database, 1, { ...input, sourceSubmissionId: 0 })
		).rejects.toMatchObject({ field: 'sourceSubmissionId' });
		expect(await loadResubmission(database, 1, 1)).toBeNull();
	});
	it('rechecks source eligibility in the insert when review state changes after preflight', async () => {
		const { database, sqlite } = fixture(1);
		sqlite.exec("UPDATE submissions SET status='rejected' WHERE id=1");
		const concurrent: Database = {
			prepare(query) {
				if (query.startsWith('INSERT INTO submissions'))
					sqlite.exec("UPDATE submissions SET status='reviewing' WHERE id=1");
				return database.prepare(query);
			}
		};
		await expect(createSubmission(concurrent, 1, input)).rejects.toMatchObject({
			field: 'sourceSubmissionId'
		});
		expect(sqlite.prepare('SELECT COUNT(*) n FROM submissions').get()).toEqual({ n: 1 });
	});
});
