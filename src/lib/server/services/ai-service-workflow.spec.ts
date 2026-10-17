import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	createAiProvider,
	updateAiProvider,
	getAiProviderById,
	listAiProviders,
	recordAiProviderTest,
	enableAiProvider
} from './ai-providers';
import { listAiCalls, recordAiCall } from './ai-call-history';
import { AiGenerationError, generateSubmissionSuggestion } from './ai-generation';
import { POST } from '../../../routes/api/admin/ai-providers/[id]/test/+server';
vi.mock('./ai-generation', async (original) => ({
	...(await original<object>()),
	generateSubmissionSuggestion: vi.fn()
}));
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		'PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);' +
			readFileSync('migrations/0011_ai_providers.sql', 'utf8') +
			readFileSync('migrations/0021_ai_service_calls.sql', 'utf8')
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
const key = Buffer.alloc(32, 7).toString('base64');
const input = {
	name: '主服务',
	baseUrl: 'https://api.example.com/v1',
	model: 'test-model',
	apiKey: 'private-api-key',
	timeoutMs: 30000,
	maxSourceChars: 8000,
	systemPrompt: '客观总结',
	isEnabled: false
};
const call = (database: Database, id: number, admin = true) =>
	POST({
		locals: { admin: admin ? { id: 1 } : null },
		platform: { env: { DB: database, AI_CONFIG_ENCRYPTION_KEY: key } },
		params: { id: String(id) },
		request: new Request('https://example.test/api/admin/ai-providers/1/test', {
			method: 'POST',
			headers: { origin: 'https://example.test' }
		}),
		url: new URL('https://example.test/api/admin/ai-providers/1/test')
	} as Parameters<typeof POST>[0]);
beforeEach(() => {
	vi.mocked(generateSubmissionSuggestion).mockReset();
	vi.mocked(generateSubmissionSuggestion).mockResolvedValue({
		title: 'a',
		summary: 'b',
		content: 'c',
		tags: []
	});
});
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));
describe('AI service workflow and traceability', () => {
	it.each(['timeoutMs', 'maxSourceChars', 'systemPrompt'] as const)(
		'invalidates tests and activation after changing %s',
		async (field) => {
			const { database } = fixture();
			const id = await createAiProvider(database, key, input);
			await recordAiProviderTest(database, id, true, null);
			await enableAiProvider(database, id);
			await updateAiProvider(database, key, id, {
				...input,
				apiKey: '',
				[field]: field === 'systemPrompt' ? '新提示词' : 12000
			});
			expect((await listAiProviders(database))[0]).toMatchObject({
				isEnabled: false,
				testStatus: 'untested',
				testedAt: null
			});
			await expect(enableAiProvider(database, id)).rejects.toThrow('测试');
		}
	);
	it('retains approval for name-only edits and does not return server revisions or secrets', async () => {
		const { database } = fixture();
		const id = await createAiProvider(database, key, input);
		await recordAiProviderTest(database, id, true, null);
		await enableAiProvider(database, id);
		await updateAiProvider(database, key, id, { ...input, name: '重命名', apiKey: '' });
		const list = await listAiProviders(database);
		expect(list[0]).toMatchObject({ name: '重命名', isEnabled: true, testStatus: 'success' });
		expect(JSON.stringify(list)).not.toMatch(/revision|ciphertext|private-api-key/);
	});
	it('rejects late tests after config changes and leaves the new config unapproved', async () => {
		const { database } = fixture();
		const id = await createAiProvider(database, key, input);
		const previous = await getAiProviderById(database, key, id);
		await updateAiProvider(database, key, id, { ...input, apiKey: '', model: 'new-model' });
		await expect(
			recordAiProviderTest(database, id, true, null, previous!.revision)
		).rejects.toThrow('配置已变化');
		expect((await listAiProviders(database))[0].testStatus).toBe('untested');
	});
	it('does not disable the active service if the target changes during activation', async () => {
		const { database, sqlite } = fixture();
		const first = await createAiProvider(database, key, input);
		const second = await createAiProvider(database, key, { ...input, name: '备用' });
		await recordAiProviderTest(database, first, true, null);
		await recordAiProviderTest(database, second, true, null);
		await enableAiProvider(database, first);
		const prepare = database.prepare.bind(database);
		database.prepare = (sql) => {
			if (sql.startsWith('UPDATE ai_providers SET is_enabled=CASE'))
				sqlite
					.prepare("UPDATE ai_providers SET test_status='untested',model='changed' WHERE id=?")
					.run(second);
			return prepare(sql);
		};
		await expect(enableAiProvider(database, second)).rejects.toThrow('配置已变化');
		expect(sqlite.prepare('SELECT id FROM ai_providers WHERE is_enabled=1').all()).toEqual([
			{ id: first }
		]);
	});
	it.each(['address', 'authentication', 'timeout', 'invalid_response'] as const)(
		'reports %s with safe guidance and records failure without leaking keys',
		async (code) => {
			const { database, sqlite } = fixture();
			const id = await createAiProvider(database, key, input);
			vi.mocked(generateSubmissionSuggestion).mockRejectedValueOnce(
				new AiGenerationError('安全错误提示', code)
			);
			const response = await call(database, id);
			expect(response.status).toBe(422);
			expect(await response.json()).toMatchObject({
				code,
				advice: expect.any(String),
				historySaved: true
			});
			const records = await listAiCalls(database, new URLSearchParams());
			expect(records.rows[0]).toMatchObject({
				origin: 'test',
				outcome: 'failed',
				error_code: code,
				model: 'test-model'
			});
			expect(JSON.stringify(sqlite.prepare('SELECT * FROM ai_service_calls').all())).not.toMatch(
				/private-api-key|客观总结/
			);
		}
	);
	it('tests without enabling, records success, and only the explicit switch activates it', async () => {
		const { database } = fixture();
		const id = await createAiProvider(database, key, input);
		expect((await call(database, id)).status).toBe(200);
		expect((await listAiProviders(database))[0]).toMatchObject({
			isEnabled: false,
			testStatus: 'success'
		});
		await enableAiProvider(database, id);
		expect((await listAiProviders(database))[0].isEnabled).toBe(true);
	});
	it('rejects unauthenticated tests before sending requests or writing records', async () => {
		const { database } = fixture();
		expect((await call(database, 1, false)).status).toBe(403);
		expect(generateSubmissionSuggestion).not.toHaveBeenCalled();
		expect((await listAiCalls(database, new URLSearchParams())).total).toBe(0);
	});
	it('filters and pages the complete history and keeps provider/model snapshots after deletion', async () => {
		const { database, sqlite } = fixture();
		const id = await createAiProvider(database, key, input);
		for (let i = 0; i < 25; i++)
			await recordAiCall(database, {
				origin: 'test',
				stage: 'generation',
				providerId: id,
				providerName: input.name,
				model: input.model,
				outcome: 'failed',
				errorCode: 'timeout',
				durationMs: 10,
				aiDurationMs: 8
			});
		await recordAiCall(database, {
			origin: 'submission',
			stage: 'webpage',
			outcome: 'skipped',
			durationMs: 5
		});
		const list = await listAiCalls(
			database,
			new URLSearchParams('origin=test&outcome=failed&page=999')
		);
		expect(list).toMatchObject({ total: 25, page: 2, pages: 2 });
		expect(list.rows).toHaveLength(5);
		sqlite.prepare('DELETE FROM ai_providers WHERE id=?').run(id);
		const archived = await listAiCalls(database, new URLSearchParams('origin=test'));
		expect(archived.rows[0]).toMatchObject({ provider_name: '主服务', model: 'test-model' });
		expect(
			(
				await listAiCalls(
					database,
					new URLSearchParams('origin=bad&outcome=bad&provider=1%20OR%201=1&page=-2')
				)
			).total
		).toBe(26);
	});
	it('disables a saved service whose key cannot be decrypted and retains a traceable identity', async () => {
		const { database, sqlite } = fixture();
		const id = await createAiProvider(database, key, input);
		await recordAiProviderTest(database, id, true, null);
		await enableAiProvider(database, id);
		sqlite.prepare("UPDATE ai_providers SET api_key_ciphertext='broken' WHERE id=?").run(id);
		const response = await call(database, id);
		expect(await response.json()).toMatchObject({ code: 'configuration' });
		expect((await listAiProviders(database))[0]).toMatchObject({
			isEnabled: false,
			testStatus: 'failed'
		});
		expect((await listAiCalls(database, new URLSearchParams())).rows[0]).toMatchObject({
			provider_name: '主服务',
			error_code: 'configuration',
			stage: 'configuration'
		});
	});
	it('keeps a successful test valid even when the diagnostic table is unavailable', async () => {
		const { database, sqlite } = fixture();
		const id = await createAiProvider(database, key, input);
		sqlite.exec('DROP TABLE ai_service_calls');
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const response = await call(database, id);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ historySaved: false });
			expect((await listAiProviders(database))[0].testStatus).toBe('success');
		} finally {
			log.mockRestore();
		}
	});
});
