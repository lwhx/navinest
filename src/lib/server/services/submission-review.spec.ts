import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	claimSubmissionReview,
	reviewSubmission,
	SubmissionReviewError
} from '$lib/server/services/submission-review';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
CREATE TABLE submissions(id INTEGER PRIMARY KEY,user_id INTEGER,target_item_id INTEGER,type TEXT,title TEXT,payload_json TEXT,status TEXT DEFAULT 'pending',review_token TEXT,review_started_at TEXT,reviewer_id INTEGER,review_message TEXT,reviewed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,category_id INTEGER,author_id INTEGER,title TEXT,slug TEXT UNIQUE,summary TEXT,content TEXT,icon_file_id INTEGER,cover_file_id INTEGER,status TEXT,visibility TEXT,sort_order INTEGER,is_featured INTEGER,published_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE tags(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,name TEXT,slug TEXT,description TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(type,slug));
CREATE TABLE files(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,bucket TEXT,object_key TEXT,mime_type TEXT,size INTEGER);
CREATE TABLE item_tags(item_id INTEGER,tag_id INTEGER); CREATE TABLE item_meta(item_id INTEGER,meta_key TEXT,meta_value TEXT);
CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,sender_id INTEGER,type TEXT,title TEXT,content TEXT,data_json TEXT,is_read INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO submissions(id,user_id,type,title,payload_json,status) VALUES(1,7,'site','Accepted','{}','pending'),(2,7,'post','Rejected','{}','pending');`);
	const database: Database = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement: DatabaseStatement = {
				bind(...next) {
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
afterEach(() => connections.splice(0).forEach((x) => x.close()));
const item = {
	type: 'site' as const,
	categoryId: null,
	iconFileId: null,
	coverFileId: null,
	title: 'Accepted',
	slug: 'accepted-site',
	summary: 'Summary',
	content: 'Content',
	status: 'published' as const,
	visibility: 'public' as const,
	sortOrder: 0,
	isFeatured: false,
	tagIds: [],
	meta: { site_url: 'https://example.com' }
};
describe('submission review', () => {
	it('publishes a pending submission and links the resulting item', async () => {
		const { database, sqlite } = fixture();
		const result = await reviewSubmission(database, 1, 9, {
			decision: 'approve',
			message: 'Looks good',
			item
		});
		expect(result).toMatchObject({ status: 'published', itemId: 1 });
		expect(
			sqlite
				.prepare(
					'SELECT status,target_item_id,reviewer_id,review_message FROM submissions WHERE id=1'
				)
				.get()
		).toMatchObject({
			status: 'published',
			target_item_id: 1,
			reviewer_id: 9,
			review_message: 'Looks good'
		});
		expect(
			sqlite.prepare('SELECT slug,status,visibility FROM items WHERE id=1').get()
		).toMatchObject({ slug: 'accepted-site', status: 'published', visibility: 'public' });
		expect(sqlite.prepare('SELECT user_id,sender_id,type,title FROM messages').get()).toMatchObject(
			{
				user_id: 7,
				sender_id: 9,
				type: 'submission_review',
				title: '投稿“Accepted”已发布'
			}
		);
	});
	it('rejects without creating content', async () => {
		const { database, sqlite } = fixture();
		const result = await reviewSubmission(database, 2, 9, {
			decision: 'reject',
			message: 'Needs more detail'
		});
		expect(result).toEqual({ status: 'rejected', itemId: null });
		expect(sqlite.prepare('SELECT COUNT(*) count FROM items').get()).toMatchObject({ count: 0 });
		expect(
			sqlite.prepare('SELECT status,review_message FROM submissions WHERE id=2').get()
		).toMatchObject({ status: 'rejected', review_message: 'Needs more detail' });
		expect(sqlite.prepare('SELECT user_id,type,title,content FROM messages').get()).toMatchObject({
			user_id: 7,
			type: 'submission_review',
			title: '投稿“Rejected”未通过审核',
			content: 'Needs more detail'
		});
	});
	it('rejects repeated review and requires a message when rejecting', async () => {
		const { database } = fixture();
		await reviewSubmission(database, 2, 9, { decision: 'reject', message: 'No' });
		await expect(
			reviewSubmission(database, 2, 9, { decision: 'reject', message: 'Again' })
		).rejects.toMatchObject({ status: 409 });
		await expect(
			reviewSubmission(database, 1, 9, { decision: 'reject', message: ' ' })
		).rejects.toBeInstanceOf(SubmissionReviewError);
	});

	it('atomically grants one review lease and rejects a concurrent reviewer', async () => {
		const { database, sqlite } = fixture();
		await expect(claimSubmissionReview(database, 1, 'first-token')).resolves.toMatchObject({
			id: 1
		});
		await expect(claimSubmissionReview(database, 1, 'second-token')).rejects.toMatchObject({
			status: 409
		});
		expect(sqlite.prepare('SELECT status,review_token FROM submissions WHERE id=1').get()).toEqual({
			status: 'reviewing',
			review_token: 'first-token'
		});
		expect(sqlite.prepare('SELECT COUNT(*) count FROM items').get()).toEqual({ count: 0 });
	});

	it('creates selected missing tags, reuses existing names, and links them on publish', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec("INSERT INTO tags(type,name,slug) VALUES('site','AI','ai')");
		const result = await reviewSubmission(database, 1, 9, {
			decision: 'approve',
			message: '',
			item: { ...item, tagIds: [1] },
			newTagNames: ['效率工具', 'AI', '效率工具']
		});
		expect(result).toMatchObject({ status: 'published', itemId: 1 });
		expect(sqlite.prepare('SELECT name FROM tags ORDER BY id').all()).toEqual([
			{ name: 'AI' },
			{ name: '效率工具' }
		]);
		expect(sqlite.prepare('SELECT tag_id FROM item_tags ORDER BY tag_id').all()).toEqual([
			{ tag_id: 1 },
			{ tag_id: 2 }
		]);
	});

	it('rejects more than eight selected new tags', async () => {
		const { database } = fixture();
		await expect(
			reviewSubmission(database, 1, 9, {
				decision: 'approve',
				message: '',
				item,
				newTagNames: Array.from({ length: 9 }, (_, index) => `标签${index}`)
			})
		).rejects.toThrow('8');
	});

	it('requires the submission icon to be an image owned by the submitter', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO files(id,user_id,bucket,object_key,mime_type,size) VALUES(1,8,'FILES','x.png','image/png',10),(2,7,'FILES','x.txt','text/plain',10),(3,7,'FILES','x.webp','image/webp',10)"
		);
		await expect(
			reviewSubmission(database, 1, 9, {
				decision: 'approve',
				message: '',
				item: { ...item, iconFileId: 1 }
			})
		).rejects.toThrow('图标');
		await expect(
			reviewSubmission(database, 1, 9, {
				decision: 'approve',
				message: '',
				item: { ...item, iconFileId: 2 }
			})
		).rejects.toThrow('图标');
		await expect(
			reviewSubmission(database, 1, 9, {
				decision: 'approve',
				message: '',
				item: { ...item, iconFileId: 3 }
			})
		).resolves.toMatchObject({ status: 'published' });
	});

	it('adds a deterministic suffix when a new tag slug is already occupied', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec("INSERT INTO tags(type,name,slug) VALUES('site','Different','a-b')");
		await reviewSubmission(database, 1, 9, {
			decision: 'approve',
			message: '',
			item,
			newTagNames: ['A B']
		});
		expect(sqlite.prepare("SELECT slug FROM tags WHERE name='A B'").get()).toEqual({
			slug: 'a-b-2'
		});
	});
});
