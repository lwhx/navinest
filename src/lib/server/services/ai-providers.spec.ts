import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	createAiProvider,
	enableAiProvider,
	getEnabledAiProvider,
	listAiProviders,
	recordAiProviderTest,
	updateAiProvider
} from '$lib/server/services/ai-providers';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		`CREATE TABLE ai_providers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,base_url TEXT,model TEXT,api_key_ciphertext TEXT,api_key_iv TEXT,key_hint TEXT,timeout_ms INTEGER,max_source_chars INTEGER,system_prompt TEXT,is_enabled INTEGER,test_status TEXT DEFAULT 'untested',tested_at TEXT,test_error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);`
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
							.all(
								...values.map((value) =>
									value instanceof ArrayBuffer ? new Uint8Array(value) : value
								)
							) as T[]
					};
				}
			};
			return statement;
		}
	};
	return { sqlite, database };
}
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));
const masterKey = Buffer.alloc(32, 7).toString('base64');
const input = {
	name: 'Primary',
	baseUrl: 'https://api.example.com/v1',
	model: 'gpt-test',
	apiKey: 'sk-super-secret',
	timeoutMs: 30000,
	maxSourceChars: 8000,
	systemPrompt: '生成客观内容',
	isEnabled: true
};

describe('AI provider configuration', () => {
	it('encrypts API keys at rest and only exposes masked metadata to list views', async () => {
		const { database, sqlite } = fixture();
		const id = await createAiProvider(database, masterKey, input);
		const stored = sqlite.prepare('SELECT * FROM ai_providers WHERE id=?').get(id) as Record<
			string,
			unknown
		>;
		expect(JSON.stringify(stored)).not.toContain('sk-super-secret');
		expect(stored.key_hint).toBe('cret');
		expect(await listAiProviders(database)).toEqual([
			expect.objectContaining({
				id,
				name: 'Primary',
				configured: true,
				keyHint: 'cret',
				isEnabled: false,
				testStatus: 'untested'
			})
		]);
		expect(JSON.stringify(await listAiProviders(database))).not.toContain('ciphertext');
		await expect(getEnabledAiProvider(database, masterKey)).resolves.toBeNull();
		await recordAiProviderTest(database, id, true, null);
		await enableAiProvider(database, id);
		await expect(getEnabledAiProvider(database, masterKey)).resolves.toMatchObject({
			apiKey: 'sk-super-secret'
		});
	});

	it('keeps the existing key on blank edit and ensures only one provider is enabled', async () => {
		const { database, sqlite } = fixture();
		const first = await createAiProvider(database, masterKey, input);
		const second = await createAiProvider(database, masterKey, {
			...input,
			name: 'Second',
			apiKey: 'second-key',
			isEnabled: false
		});
		await recordAiProviderTest(database, second, true, null);
		await enableAiProvider(database, second);
		await updateAiProvider(database, masterKey, second, {
			...input,
			name: 'Second',
			apiKey: '',
			isEnabled: true
		});
		expect(sqlite.prepare('SELECT id,is_enabled FROM ai_providers ORDER BY id').all()).toEqual([
			{ id: first, is_enabled: 0 },
			{ id: second, is_enabled: 1 }
		]);
		await expect(getEnabledAiProvider(database, masterKey)).resolves.toMatchObject({
			apiKey: 'second-key'
		});
		await updateAiProvider(database, masterKey, second, {
			...input,
			name: 'Second',
			apiKey: 'changed-key',
			isEnabled: true
		});
		expect(
			sqlite.prepare('SELECT is_enabled,test_status FROM ai_providers WHERE id=?').get(second)
		).toEqual({ is_enabled: 0, test_status: 'untested' });
	});

	it('rejects unsafe provider URLs and missing encryption keys', async () => {
		const { database } = fixture();
		await expect(createAiProvider(database, '', input)).rejects.toThrow('加密');
		await expect(
			createAiProvider(database, masterKey, { ...input, baseUrl: 'http://127.0.0.1/v1' })
		).rejects.toThrow('私网');
	});
});
