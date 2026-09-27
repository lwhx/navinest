import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	listMessageBatches,
	listMessageRecipients,
	messageStats,
	sendAdminMessage,
	validateAdminMessageInput,
	withdrawMessageBatch
} from '$lib/server/services/admin-messages';

const connections: DatabaseSync[] = [];

function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT,display_name TEXT,role TEXT,status TEXT);
CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,sender_id INTEGER,type TEXT,title TEXT,content TEXT,data_json TEXT,batch_id TEXT,is_read INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO users(id,username,display_name,role,status) VALUES(1,'admin','Admin','admin','active'),(2,'blackice','Black Ice','user','active'),(3,'retired','Retired','user','disabled');
INSERT INTO messages(user_id,sender_id,type,title,content,batch_id,is_read,created_at) VALUES(2,1,'submission_review','投稿“A”已发布','已通过审核',NULL,1,'2026-09-01 10:00:00'),(2,1,'announcement','站点维护','今晚维护','batch-1',1,'2026-09-02 10:00:00'),(1,1,'announcement','站点维护','今晚维护','batch-1',0,'2026-09-02 10:00:00');
`);
	const db: Database = {
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
	return { sqlite, db };
}

afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('administrator message validation', () => {
	it('accepts a broadcast with a trimmed title and body', () => {
		expect(
			validateAdminMessageInput({
				scope: 'all',
				type: 'announcement',
				title: '  站点维护  ',
				content: '  今晚维护  '
			})
		).toEqual({
			valid: true,
			data: {
				scope: 'all',
				userId: null,
				type: 'announcement',
				title: '站点维护',
				content: '今晚维护'
			}
		});
	});

	it('requires recipients, titles and sane scopes', () => {
		expect(validateAdminMessageInput({ scope: 'user', title: '' })).toMatchObject({
			valid: false,
			errors: { userId: expect.any(String), title: expect.any(String) }
		});
		expect(
			validateAdminMessageInput({ scope: 'nobody', type: 'email', title: 'x', content: 'y' })
		).toMatchObject({
			valid: false,
			errors: { scope: expect.any(String), type: expect.any(String) }
		});
	});

	it('coerces string identifiers and caps the body length', () => {
		expect(validateAdminMessageInput({ scope: 'user', userId: '7', title: 'x' })).toMatchObject({
			valid: true,
			data: { userId: 7 }
		});
		expect(
			validateAdminMessageInput({ scope: 'all', title: 'x', content: 'y'.repeat(2001) })
		).toMatchObject({ valid: false, errors: { content: expect.any(String) } });
	});
});

describe('administrator message batches', () => {
	it('lists active recipients with administrators first', async () => {
		const { db } = fixture();
		expect(await listMessageRecipients(db)).toEqual([
			{ id: 1, username: 'admin', displayName: 'Admin', role: 'admin' },
			{ id: 2, username: 'blackice', displayName: 'Black Ice', role: 'user' }
		]);
	});

	it('broadcasts to every active account in one batch', async () => {
		const { db, sqlite } = fixture();
		const result = await sendAdminMessage(db, 1, {
			scope: 'all',
			userId: null,
			type: 'system',
			title: '维护完成',
			content: null
		});
		expect(result.recipients).toBe(2);
		const rows = sqlite
			.prepare(
				'SELECT user_id,sender_id,type,is_read FROM messages WHERE batch_id=? ORDER BY user_id'
			)
			.all(result.batchId) as { user_id: number; sender_id: number; is_read: number }[];
		expect(rows.map((row) => row.user_id)).toEqual([1, 2]);
		expect(rows.every((row) => row.sender_id === 1 && row.is_read === 0)).toBe(true);
	});

	it('targets administrators only or a single active account', async () => {
		const { db } = fixture();
		const admins = await sendAdminMessage(db, 1, {
			scope: 'admins',
			userId: null,
			type: 'announcement',
			title: '仅管理员',
			content: null
		});
		expect(admins.recipients).toBe(1);
		const single = await sendAdminMessage(db, 1, {
			scope: 'user',
			userId: 2,
			type: 'system',
			title: '定向通知',
			content: null
		});
		expect(single.recipients).toBe(1);
		await expect(
			sendAdminMessage(db, 1, {
				scope: 'user',
				userId: 3,
				type: 'system',
				title: '停用账号',
				content: null
			})
		).rejects.toMatchObject({ status: 404, field: 'userId' });
	});

	it('groups batches with read progress and keeps system messages out', async () => {
		const { db } = fixture();
		const batches = await listMessageBatches(db);
		expect(batches).toHaveLength(1);
		expect(batches[0]).toMatchObject({
			batchId: 'batch-1',
			sender: 'Admin',
			type: 'announcement',
			title: '站点维护',
			recipients: 2,
			read: 1
		});
	});

	it('counts messages by type and unread totals', async () => {
		const { db } = fixture();
		expect(await messageStats(db)).toEqual({
			batches: 1,
			announcements: 2,
			system: 0,
			review: 1,
			unread: 1
		});
	});

	it('withdraws a whole batch and reports unknown batches', async () => {
		const { db, sqlite } = fixture();
		await expect(withdrawMessageBatch(db, 'batch-1')).resolves.toBe(2);
		expect(
			sqlite.prepare('SELECT COUNT(*) count FROM messages WHERE batch_id=?').get('batch-1')
		).toEqual({ count: 0 });
		expect(
			sqlite.prepare("SELECT COUNT(*) count FROM messages WHERE type='submission_review'").get()
		).toEqual({ count: 1 });
		await expect(withdrawMessageBatch(db, 'batch-1')).rejects.toMatchObject({ status: 404 });
		await expect(withdrawMessageBatch(db, '  ')).rejects.toMatchObject({ status: 400 });
	});
});
