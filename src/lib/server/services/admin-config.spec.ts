import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { validateHomeModuleInput, validateSearchEngineInput } from '$lib/server/admin-validation';
import {
	createHomeModule,
	createSearchEngine,
	deleteHomeModule,
	deleteSearchEngine,
	updateHomeModule,
	updateSearchEngine
} from '$lib/server/services/admin-write';

const connections: DatabaseSync[] = [];

function createDatabase() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
		CREATE TABLE home_modules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			title TEXT NOT NULL,
			config_json TEXT NOT NULL DEFAULT '{}',
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_enabled INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE search_engines (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			group_key TEXT NOT NULL,
			name TEXT NOT NULL,
			key TEXT NOT NULL UNIQUE,
			url_template TEXT NOT NULL,
			placeholder TEXT,
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_enabled INTEGER NOT NULL DEFAULT 1
		);
	`);

	const database: Database & { batch(statements: DatabaseStatement[]): Promise<void> } = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement: DatabaseStatement = {
				bind(...nextValues) {
					values = nextValues;
					return statement;
				},
				async all<T>() {
					const sqliteValues = values.map((value) =>
						value instanceof ArrayBuffer ? new Uint8Array(value) : value
					);
					const rows = sqlite.prepare(query).all(...sqliteValues) as T[];
					return { results: rows };
				}
			};
			return statement;
		},
		async batch(statements) {
			for (const statement of statements) await statement.all();
		}
	};
	return { database, sqlite };
}

afterEach(() => {
	for (const connection of connections.splice(0)) connection.close();
});

describe('administrator configuration validation', () => {
	it('normalizes modules and rejects malformed JSON configuration', () => {
		expect(
			validateHomeModuleInput({
				type: 'content',
				title: ' 推荐内容 ',
				configJson: '{"limit":8}',
				sortOrder: '20',
				isEnabled: 'on'
			})
		).toEqual({
			valid: true,
			data: {
				type: 'content',
				title: '推荐内容',
				config: { limit: 8 },
				sortOrder: 20,
				isEnabled: true
			}
		});
		expect(validateHomeModuleInput({ type: 'unknown', title: '', configJson: '[]' })).toMatchObject(
			{
				valid: false,
				errors: {
					type: expect.any(String),
					title: expect.any(String),
					configJson: expect.any(String)
				}
			}
		);
	});

	it('requires safe search templates containing the query token', () => {
		expect(
			validateSearchEngineInput({
				groupKey: ' web ',
				name: ' Google ',
				key: 'google',
				urlTemplate: 'https://www.google.com/search?q={query}',
				isEnabled: true
			})
		).toMatchObject({
			valid: true,
			data: { groupKey: 'web', name: 'Google', key: 'google', isEnabled: true }
		});
		expect(
			validateSearchEngineInput({
				groupKey: 'web',
				name: 'Internal',
				key: 'Bad Key',
				urlTemplate: 'http://127.0.0.1/search'
			})
		).toMatchObject({
			valid: false,
			errors: { key: expect.any(String), urlTemplate: expect.any(String) }
		});
	});
});

describe('administrator configuration writes', () => {
	it('creates, updates and deletes modules and search engines', async () => {
		const { database, sqlite } = createDatabase();
		const moduleValidation = validateHomeModuleInput({
			type: 'content',
			title: '推荐',
			configJson: '{"limit":6}'
		});
		if (!moduleValidation.valid) throw new Error(JSON.stringify(moduleValidation.errors));
		const moduleId = await createHomeModule(database, moduleValidation.data);
		const updatedModule = validateHomeModuleInput({
			type: 'links',
			title: '快捷入口',
			configJson: '{"columns":4}',
			isEnabled: false
		});
		if (!updatedModule.valid) throw new Error(JSON.stringify(updatedModule.errors));
		await updateHomeModule(database, moduleId, updatedModule.data);
		expect(sqlite.prepare('SELECT type, config_json, is_enabled FROM home_modules').get()).toEqual({
			type: 'links',
			config_json: '{"columns":4}',
			is_enabled: 0
		});

		const engineValidation = validateSearchEngineInput({
			groupKey: 'web',
			name: 'Google',
			key: 'google',
			urlTemplate: 'https://google.com/search?q={query}'
		});
		if (!engineValidation.valid) throw new Error(JSON.stringify(engineValidation.errors));
		const engineId = await createSearchEngine(database, engineValidation.data);
		const updatedEngine = validateSearchEngineInput({
			groupKey: 'code',
			name: 'GitHub',
			key: 'github',
			urlTemplate: 'https://github.com/search?q={query}',
			isEnabled: false
		});
		if (!updatedEngine.valid) throw new Error(JSON.stringify(updatedEngine.errors));
		await updateSearchEngine(database, engineId, updatedEngine.data);
		expect(sqlite.prepare('SELECT group_key, key, is_enabled FROM search_engines').get()).toEqual({
			group_key: 'code',
			key: 'github',
			is_enabled: 0
		});

		await deleteHomeModule(database, moduleId);
		await deleteSearchEngine(database, engineId);
		expect(sqlite.prepare('SELECT COUNT(*) AS count FROM home_modules').get()).toEqual({
			count: 0
		});
		expect(sqlite.prepare('SELECT COUNT(*) AS count FROM search_engines').get()).toEqual({
			count: 0
		});
	});
});
