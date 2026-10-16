import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	listMessageBatches,
	listMessageRecipients,
	messageStats,
	sendAdminMessage as deliverAdminMessage,
	previewAdminMessage,
	loadMessageBatches,
	getMessageBatch,
	type AdminMessageInput,
	validateAdminMessageInput,
	withdrawMessageBatch
} from '$lib/server/services/admin-messages';

const connections: DatabaseSync[] = [];
async function sendAdminMessage(db: Database, sender: number, input: AdminMessageInput) {
	return deliverAdminMessage(db, sender, input, await previewAdminMessage(db, sender, input));
}
const broadcast: AdminMessageInput = {
	scope: 'all',
	userId: null,
	type: 'system',
	title: '完整群发',
	content: '正文'
};

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
		expect((await listMessageRecipients(db)).recipients).toEqual([
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
		).rejects.toMatchObject({ status: 409, field: 'userId' });
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
		).toEqual({ count: 2 });
		expect(
			sqlite.prepare("SELECT COUNT(*) count FROM messages WHERE type='submission_review'").get()
		).toEqual({ count: 1 });
		await expect(withdrawMessageBatch(db, 'batch-1')).resolves.toBe(2);
		expect((await getMessageBatch(db, 'batch-1'))?.withdrawnAt).toBeTruthy();
		await expect(withdrawMessageBatch(db, 'missing')).rejects.toMatchObject({ status: 404 });
		await expect(withdrawMessageBatch(db, '  ')).rejects.toMatchObject({ status: 400 });
	});
});

describe('message delivery recovery and full history', () => {
	it('requires a valid preview, rejects changed content and audience', async () => {
		const { db, sqlite } = fixture(),
			proof = await previewAdminMessage(db, 1, broadcast);
		await expect(deliverAdminMessage(db, 1, broadcast, null)).rejects.toThrow('预览');
		await expect(
			deliverAdminMessage(db, 1, { ...broadcast, title: '修改' }, proof)
		).rejects.toMatchObject({ status: 409 });
		sqlite.exec("UPDATE users SET status='disabled' WHERE id=2");
		await expect(deliverAdminMessage(db, 1, broadcast, proof)).rejects.toMatchObject({
			status: 409
		});
		expect(sqlite.prepare('SELECT COUNT(*) n FROM messages').get()).toEqual({ n: 3 });
	});
	it('sends beyond 1000 recipients with one insert and supports replay after withdrawal', async () => {
		const { db, sqlite } = fixture();
		for (let id = 4; id < 1104; id++)
			sqlite
				.prepare("INSERT INTO users VALUES(?,?,?,'user','active')")
				.run(id, 'user' + id, '用户' + id);
		const proof = await previewAdminMessage(db, 1, broadcast);
		expect(proof.recipients).toBe(1102);
		const [a, b] = await Promise.all([
			deliverAdminMessage(db, 1, broadcast, proof),
			deliverAdminMessage(db, 1, broadcast, proof)
		]);
		expect(a.batchId).toBe(b.batchId);
		expect(
			sqlite.prepare('SELECT COUNT(*) n FROM messages WHERE batch_id=?').get(proof.batchId)
		).toEqual({ n: 1102 });
		await withdrawMessageBatch(db, proof.batchId);
		const replay = await deliverAdminMessage(db, 1, broadcast, proof);
		expect(replay.withdrawnAt).toBeTruthy();
		expect(replay.repeated).toBe(true);
		expect((await messageStats(db)).system).toBe(0);
	});
	it('rolls back every recipient if a later insert fails', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"CREATE TRIGGER fail_second BEFORE INSERT ON messages WHEN NEW.user_id=2 AND NEW.type='system' BEGIN SELECT RAISE(ABORT,'injected failure'); END"
		);
		const proof = await previewAdminMessage(db, 1, broadcast);
		await expect(deliverAdminMessage(db, 1, broadcast, proof)).rejects.toThrow('injected failure');
		expect(await getMessageBatch(db, proof.batchId)).toBeNull();
	});
	it('rejects audience changes at the final insert and recovers a lost committed reply', async () => {
		const { db, sqlite } = fixture();
		let change = true,
			lose = false;
		const wrapped: Database = {
			prepare(query) {
				const statement = db.prepare(query);
				let values: DatabaseValue[] = [];
				const proxy: DatabaseStatement = {
					bind(...next) {
						values = next;
						return proxy;
					},
					async all<T>() {
						if (query.startsWith('INSERT INTO messages')) {
							if (change) {
								change = false;
								sqlite.exec("UPDATE users SET display_name='变更' WHERE id=2");
							}
							const result = await statement.bind(...values).all<T>();
							if (lose) {
								lose = false;
								throw new Error('reply lost');
							}
							return result;
						}
						return statement.bind(...values).all<T>();
					}
				};
				return proxy;
			}
		};
		let proof = await previewAdminMessage(wrapped, 1, broadcast);
		await expect(deliverAdminMessage(wrapped, 1, broadcast, proof)).rejects.toMatchObject({
			status: 409
		});
		expect(await getMessageBatch(db, proof.batchId)).toBeNull();
		proof = await previewAdminMessage(wrapped, 1, broadcast);
		lose = true;
		await expect(deliverAdminMessage(wrapped, 1, broadcast, proof)).rejects.toThrow('reply lost');
		expect((await deliverAdminMessage(wrapped, 1, broadcast, proof)).repeated).toBe(true);
	});
	it('paginates all batches, escapes wildcard search and clamps pages', async () => {
		const { db, sqlite } = fixture();
		const insert = sqlite.prepare(
			"INSERT INTO messages(user_id,sender_id,type,title,content,batch_id) VALUES(2,1,'system',?,? ,?)"
		);
		for (let n = 0; n < 225; n++)
			insert.run('批次' + n, n === 0 ? '100%_完整' : '正文', 'page-' + n);
		const all = await loadMessageBatches(db, new URLSearchParams('page=999'));
		expect(all.total).toBe(226);
		expect(all.filters.page).toBe(12);
		expect(all.batches).toHaveLength(6);
		const match = await loadMessageBatches(db, new URLSearchParams('q=%25_'));
		expect(match.total).toBe(1);
		await withdrawMessageBatch(db, 'page-0');
		expect((await loadMessageBatches(db, new URLSearchParams('status=withdrawn'))).total).toBe(1);
	});
	it('rejects expired proofs and keeps personal search bounded without hiding exact matches', async () => {
		const { db, sqlite } = fixture(),
			proof = await previewAdminMessage(db, 1, broadcast);
		await expect(
			deliverAdminMessage(db, 1, broadcast, { ...proof, createdAt: Date.now() - 16 * 60 * 1000 })
		).rejects.toMatchObject({ status: 409 });
		for (let id = 4; id < 30; id++)
			sqlite
				.prepare("INSERT INTO users VALUES(?,?,?,'user','active')")
				.run(id, 'exact' + id, '用户' + id);
		expect((await listMessageRecipients(db)).hasMore).toBe(true);
		expect((await listMessageRecipients(db, 'exact29')).recipients.map((r) => r.id)).toEqual([29]);
	});
});

describe('historical withdrawal payloads', () => {
	it('withdraws arrays, scalar JSON and malformed JSON safely', async () => {
		const { db, sqlite } = fixture();
		for (const data of ['[]', 'null', '"scalar"', '{bad']) {
			sqlite.prepare("UPDATE messages SET data_json=? WHERE batch_id='batch-1'").run(data);
			await withdrawMessageBatch(db, 'batch-1');
			expect((await getMessageBatch(db, 'batch-1'))?.withdrawnAt).toBeTruthy();
		}
	});
});

describe('legacy message schema compatibility', () => {
	it('loads, sends, replays and withdraws without the historical batch column', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec('ALTER TABLE messages DROP COLUMN batch_id');
		const history = await loadMessageBatches(db, new URLSearchParams());
		expect(history.total).toBe(0);
		expect((await messageStats(db)).batches).toBe(0);
		const proof = await previewAdminMessage(db, 1, broadcast);
		const sent = await deliverAdminMessage(db, 1, broadcast, proof);
		expect(sent.recipients).toBe(2);
		expect((await loadMessageBatches(db, new URLSearchParams())).total).toBe(1);
		await withdrawMessageBatch(db, sent.batchId);
		expect((await deliverAdminMessage(db, 1, broadcast, proof)).withdrawnAt).toBeTruthy();
		sqlite.exec('ALTER TABLE messages ADD COLUMN batch_id TEXT');
		expect((await loadMessageBatches(db, new URLSearchParams())).total).toBe(1);
	});
});
