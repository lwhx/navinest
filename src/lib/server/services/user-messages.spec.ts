import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	createReviewMessage,
	listUserMessages,
	markMessageRead,
	UserMessageError
} from '$lib/server/services/user-messages';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,sender_id INTEGER,type TEXT DEFAULT 'system',title TEXT NOT NULL,content TEXT,data_json TEXT,is_read INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`
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
describe('user messages', () => {
	it('creates review messages and lists only the owner messages', async () => {
		const { database } = fixture();
		const id = await createReviewMessage(database, {
			userId: 7,
			senderId: 1,
			submissionId: 10,
			submissionTitle: 'Example',
			status: 'published',
			content: 'Approved',
			item: { id: 20, type: 'site', slug: 'example' }
		});
		await createReviewMessage(database, {
			userId: 8,
			senderId: 1,
			submissionId: 11,
			submissionTitle: 'Other',
			status: 'rejected',
			content: 'No',
			item: null
		});
		expect(await listUserMessages(database, 7)).toMatchObject([
			{
				id,
				type: 'submission_review',
				title: '投稿“Example”已发布',
				content: 'Approved',
				isRead: false,
				data: {
					submissionId: 10,
					status: 'published',
					item: { id: 20, type: 'site', slug: 'example' }
				}
			}
		]);
	});
	it('marks an owned message read idempotently and blocks cross-user access', async () => {
		const { database } = fixture();
		const id = await createReviewMessage(database, {
			userId: 7,
			senderId: 1,
			submissionId: 10,
			submissionTitle: 'Example',
			status: 'rejected',
			content: 'Needs work',
			item: null
		});
		await markMessageRead(database, 7, id);
		await markMessageRead(database, 7, id);
		expect((await listUserMessages(database, 7))[0].isRead).toBe(true);
		await expect(markMessageRead(database, 8, id)).rejects.toBeInstanceOf(UserMessageError);
	});
});
