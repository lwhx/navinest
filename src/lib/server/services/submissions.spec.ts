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
		`CREATE TABLE submissions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,target_item_id INTEGER,type TEXT NOT NULL,title TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reviewer_id INTEGER,review_message TEXT,reviewed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);`
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
});
