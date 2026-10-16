import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	createReviewMessage,
	listUserMessages,
	loadUserMessages,
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

describe('inbox filtering and recovery', () => {
	it('paginates beyond 100, filters globally, hides withdrawals and isolates owners', async () => {
		const { sqlite, database } = fixture(),
			stmt = sqlite.prepare(
				"INSERT INTO messages(user_id,type,title,content,data_json,is_read) VALUES(?,'system',?,?,?,?)"
			);
		for (let n = 0; n < 225; n++)
			stmt.run(
				7,
				'消息' + n,
				n === 0 ? '精确%_正文' : '正文',
				n === 1
					? 'bad json'
					: n === 2
						? JSON.stringify({ withdrawnAt: '2026-10-17T00:00:00Z' })
						: null,
				n % 2
			);
		stmt.run(8, '其他用户', '精确%_正文', null, 0);
		let result = await loadUserMessages(database, 7, new URLSearchParams('page=999'));
		expect(result.total).toBe(224);
		expect(result.pageCount).toBe(12);
		expect(result.messages).toHaveLength(4);
		result = await loadUserMessages(database, 7, new URLSearchParams('q=%25_&status=unread'));
		expect(result.total).toBe(1);
		expect(result.messages[0].title).toBe('消息0');
		const broken = await loadUserMessages(database, 7, new URLSearchParams('q=消息1'));
		expect(broken.total).toBeGreaterThan(20);
		await expect(markMessageRead(database, 7, 3)).rejects.toBeInstanceOf(UserMessageError);
	});
	it('tolerates malformed payloads and projects no internal delivery metadata', async () => {
		const { sqlite, database } = fixture();
		sqlite.exec(
			`INSERT INTO messages(user_id,title,data_json) VALUES(7,'损坏','{bad'),(7,'普通','{"dispatchDigest":"private","recipientCount":42,"item":{"id":1,"type":"invalid","slug":"bad"}}')`
		);
		const result = await listUserMessages(database, 7);
		expect(result.find((r) => r.title === '损坏')?.data).toBeNull();
		expect(JSON.stringify(result)).not.toContain('private');
		expect(result[0].data?.item).toBeNull();
	});
});
