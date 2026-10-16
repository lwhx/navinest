import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	createSubmission,
	listUserSubmissions,
	SubmissionError
} from '$lib/server/services/submissions';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE files(id INTEGER PRIMARY KEY,user_id INTEGER,bucket TEXT,mime_type TEXT); CREATE TABLE submissions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,target_item_id INTEGER,type TEXT NOT NULL,title TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reviewer_id INTEGER,review_message TEXT,reviewed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);`
	);
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

describe('user submissions', () => {
	it('creates a normalized pending submission and lists only the owner records', async () => {
		const { database, sqlite } = fixture();
		const id = await createSubmission(database, 7, {
			type: 'site',
			title: ' GitHub Mirror ',
			summary: ' Useful mirror ',
			content: '',
			url: 'https://example.com/path',
			tagNames: ['开发', '效率', '开发'],
			webSnapshot: {
				fetchedUrl: 'https://example.com/path',
				title: 'Original title',
				description: 'Original description',
				excerpt: 'Original excerpt',
				siteName: 'Example',
				fetchedAt: '2026-07-14T00:00:00.000Z'
			},
			aiSuggestion: {
				title: 'GitHub Mirror',
				summary: 'Useful mirror',
				content: 'For teams',
				tags: ['开发', '效率'],
				provider: 'Primary',
				model: 'gpt-test',
				generatedAt: '2026-07-14T00:00:01.000Z'
			}
		});
		await createSubmission(database, 8, {
			type: 'post',
			title: 'Other',
			summary: null,
			content: 'Text',
			url: null
		});
		expect(
			sqlite
				.prepare('SELECT user_id,type,title,status,target_item_id FROM submissions WHERE id=?')
				.get(id)
		).toMatchObject({
			user_id: 7,
			type: 'site',
			title: 'GitHub Mirror',
			status: 'pending',
			target_item_id: null
		});
		expect(await listUserSubmissions(database, 7)).toMatchObject([
			{
				id,
				type: 'site',
				title: 'GitHub Mirror',
				status: 'pending',
				payload: expect.objectContaining({
					summary: 'Useful mirror',
					content: null,
					url: 'https://example.com/path',
					tagNames: ['开发', '效率'],
					webSnapshot: expect.objectContaining({ title: 'Original title' }),
					aiSuggestion: expect.objectContaining({ provider: 'Primary', model: 'gpt-test' })
				})
			}
		]);
	});
	it('does not save a dangling icon when it is removed after validation', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec("INSERT INTO files VALUES(1,7,'FILES','image/png')");
		const concurrent: Database = {
			prepare(query) {
				if (query.startsWith('INSERT INTO submissions'))
					sqlite.exec('DELETE FROM files WHERE id=1');
				return database.prepare(query);
			}
		};
		await expect(
			createSubmission(concurrent, 7, {
				type: 'site',
				title: '图片竞争',
				url: 'https://example.com',
				summary: null,
				content: null,
				iconFileId: 1
			})
		).rejects.toMatchObject({ field: 'iconFileId' });
		expect(sqlite.prepare('SELECT COUNT(*) n FROM submissions').get()).toEqual({ n: 0 });
	});
	it('rejects unsupported types, unsafe URLs and missing required URLs', async () => {
		const { database } = fixture();
		await expect(
			createSubmission(database, 7, {
				type: 'bulletin',
				title: 'No',
				summary: null,
				content: null,
				url: null
			})
		).rejects.toBeInstanceOf(SubmissionError);
		await expect(
			createSubmission(database, 7, {
				type: 'site',
				title: 'No URL',
				summary: null,
				content: null,
				url: null
			})
		).rejects.toBeInstanceOf(SubmissionError);
		await expect(
			createSubmission(database, 7, {
				type: 'app',
				title: 'Private',
				summary: null,
				content: null,
				url: 'http://127.0.0.1'
			})
		).rejects.toBeInstanceOf(SubmissionError);
	});
	it('rejects empty and oversized text', async () => {
		const { database } = fixture();
		await expect(
			createSubmission(database, 7, {
				type: 'post',
				title: ' ',
				summary: null,
				content: null,
				url: null
			})
		).rejects.toBeInstanceOf(SubmissionError);
		await expect(
			createSubmission(database, 7, {
				type: 'post',
				title: 'Valid',
				summary: 'x'.repeat(501),
				content: null,
				url: null
			})
		).rejects.toBeInstanceOf(SubmissionError);
	});

	it('stores valid user category and owned icon while rejecting cross-type or foreign relations', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec(
			"CREATE TABLE categories(id INTEGER PRIMARY KEY,type TEXT,is_visible INTEGER,parent_id INTEGER,name TEXT); CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY,user_id INTEGER,bucket TEXT,mime_type TEXT); INSERT INTO categories VALUES(10,'site',1,NULL,'开发'),(11,'app',1,NULL,'历史软件'); INSERT INTO files VALUES(20,7,'FILES','image/png'),(21,8,'FILES','image/png')"
		);
		const id = await createSubmission(database, 7, {
			type: 'site',
			title: 'Valid',
			summary: null,
			content: null,
			url: 'https://example.com',
			userCategoryId: 10,
			iconFileId: 20,
			iconSource: 'manual'
		});
		const payload = JSON.parse(
			String(
				(
					sqlite.prepare('SELECT payload_json FROM submissions WHERE id=?').get(id) as {
						payload_json: string;
					}
				).payload_json
			)
		);
		expect(payload).toMatchObject({ userCategoryId: 10, iconFileId: 20, iconSource: 'manual' });
		await expect(
			createSubmission(database, 7, {
				type: 'site',
				title: 'Bad category',
				summary: null,
				content: null,
				url: 'https://example.com',
				userCategoryId: 11
			})
		).rejects.toThrow('分类');
		await expect(
			createSubmission(database, 7, {
				type: 'site',
				title: 'Foreign icon',
				summary: null,
				content: null,
				url: 'https://example.com',
				iconFileId: 21
			})
		).rejects.toThrow('图标');
	});

	it('rejects retired new-submission types even with a valid public URL', async () => {
		const { database, sqlite } = fixture();
		for (const type of ['app', 'book', 'bulletin']) {
			await expect(
				createSubmission(database, 7, {
					type,
					title: '旧类型',
					summary: null,
					content: '内容',
					url: 'https://example.com'
				})
			).rejects.toMatchObject({ field: 'type' });
		}
		expect(sqlite.prepare('SELECT COUNT(*) AS n FROM submissions').get()).toMatchObject({ n: 0 });
	});

	it('allows original articles without URLs and requires their body', async () => {
		const { database } = fixture();
		await createSubmission(database, 7, {
			type: 'post',
			title: '原创文章',
			summary: '摘要',
			content: '  完整文章正文  ',
			url: ''
		});
		expect((await listUserSubmissions(database, 7))[0].payload).toMatchObject({
			content: '完整文章正文',
			url: null
		});
		await expect(
			createSubmission(database, 7, {
				type: 'post',
				title: '空正文',
				summary: null,
				content: '  ',
				url: null
			})
		).rejects.toMatchObject({ field: 'content' });
	});

	it('requires a visible same-type category path and rejects malformed category IDs', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec(
			"CREATE TABLE categories(id INTEGER PRIMARY KEY,type TEXT,is_visible INTEGER,parent_id INTEGER,name TEXT); INSERT INTO categories VALUES(1,'site',1,NULL,'一级'),(2,'site',1,1,'二级'),(3,'site',0,NULL,'隐藏'),(4,'site',1,3,'隐藏子类'),(5,'post',1,NULL,'文章'),(6,'site',1,5,'跨类型'),(7,'site',1,8,'循环一'),(8,'site',1,7,'循环二')"
		);
		const input = {
			type: 'site',
			title: '资源',
			summary: null,
			content: null,
			url: 'https://example.com'
		};
		await createSubmission(database, 7, { ...input, userCategoryId: 2 });
		for (const userCategoryId of [4, 5, 6, 7, 999, -1, 1.5, Number.NaN]) {
			await expect(
				createSubmission(database, 7, { ...input, userCategoryId })
			).rejects.toMatchObject({ field: 'userCategoryId' });
		}
		expect(sqlite.prepare('SELECT COUNT(*) AS n FROM submissions').get()).toMatchObject({ n: 1 });
	});
});
