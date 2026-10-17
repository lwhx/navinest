import { getEnabledAiProvider } from '$lib/server/services/ai-providers';
import {
	generateSubmissionSuggestion,
	AiGenerationError
} from '$lib/server/services/ai-generation';
import { recordAiCall } from '$lib/server/services/ai-call-history';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { finalizeAiUsage, reserveAiUsage } from '$lib/server/services/ai-usage';
import { fetchWebSnapshot } from '$lib/server/services/web-enrichment';
import { POST } from './+server';

vi.mock('$lib/server/services/ai-call-history', () => ({ recordAiCall: vi.fn(async () => true) }));
vi.mock('$lib/server/services/site-settings', () => ({
	loadSiteSettings: async () => ({ submissionsOpen: true })
}));
vi.mock('$lib/server/services/ai-providers', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/services/ai-providers')>()),
	getEnabledAiProvider: vi.fn(async () => null)
}));
vi.mock('$lib/server/services/ai-generation', async (original) => ({
	...(await original<object>()),
	generateSubmissionSuggestion: vi.fn(async () => ({
		title: '建议',
		summary: '简介',
		content: '说明',
		tags: []
	}))
}));
vi.mock('$lib/server/services/ai-usage', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/services/ai-usage')>()),
	reserveAiUsage: vi.fn(async () => ({ token: 'local-test-reservation' })),
	finalizeAiUsage: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/services/web-enrichment', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/services/web-enrichment')>()),
	fetchWebSnapshot: vi.fn(async () => ({
		fetchedUrl: 'https://example.com/reference',
		title: '网页',
		description: '',
		excerpt: '',
		siteName: 'Example',
		fetchedAt: '2026-10-16T00:00:00Z'
	}))
}));

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(
		"CREATE TABLE categories(id INTEGER PRIMARY KEY,type TEXT,parent_id INTEGER,name TEXT,slug TEXT,icon TEXT,description TEXT,sort_order INTEGER DEFAULT 0,is_visible INTEGER DEFAULT 1,created_at TEXT,updated_at TEXT); CREATE TABLE items(id INTEGER PRIMARY KEY,title TEXT,status TEXT,visibility TEXT); CREATE TABLE item_meta(item_id INTEGER,meta_key TEXT,meta_value TEXT); CREATE TABLE submissions(status TEXT,payload_json TEXT); INSERT INTO categories(id,type,parent_id,name,slug,is_visible) VALUES(1,'site',NULL,'开发','dev',1),(2,'site',1,'代码','code',1),(3,'site',NULL,'隐藏','hidden',0),(4,'site',3,'隐藏的子级','hidden-child',1),(5,'post',NULL,'文章','posts',1),(6,'site',5,'跨类型子级','wrong-child',1)"
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
const call = (database: Database, body: unknown) =>
	POST({
		locals: { user: { id: 7 } },
		platform: { env: { DB: database } },
		request: new Request('https://example.test/api/submissions/enrich', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0]);
beforeEach(() => vi.clearAllMocks());
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('public contribution enrichment', () => {
	it('rejects retired types before using the AI quota or fetching a webpage', async () => {
		const { database } = fixture();
		for (const type of ['app', 'book', 'bulletin'])
			expect((await call(database, { type, url: 'https://example.com' })).status).toBe(400);
		expect(reserveAiUsage).not.toHaveBeenCalled();
		expect(fetchWebSnapshot).not.toHaveBeenCalled();
	});
	it('rejects malformed request shapes without using quota', async () => {
		const { database } = fixture();
		for (const body of [null, [], 'invalid']) expect((await call(database, body)).status).toBe(400);
		expect(reserveAiUsage).not.toHaveBeenCalled();
	});
	it('finalizes reserved usage when a downstream parser fails', async () => {
		const { database } = fixture();
		vi.mocked(fetchWebSnapshot).mockRejectedValueOnce(new SyntaxError('downstream parser'));
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			expect((await call(database, { type: 'site', url: 'https://example.com' })).status).toBe(500);
			expect(recordAiCall).toHaveBeenCalledWith(
				database,
				expect.objectContaining({
					origin: 'submission',
					stage: 'webpage',
					outcome: 'failed',
					errorCode: 'webpage'
				})
			);
			expect(finalizeAiUsage).toHaveBeenCalledWith(
				database,
				expect.objectContaining({
					token: 'local-test-reservation',
					success: false,
					errorCode: 'SyntaxError'
				})
			);
		} finally {
			log.mockRestore();
		}
	});
	it('only suggests categories with complete visible paths of the requested type', async () => {
		const { database } = fixture();
		const body = await (await call(database, { type: 'site', url: 'https://example.com' })).json();
		expect(
			body.categories.map((category: { id: number; name: string }) => [category.id, category.name])
		).toEqual([
			[2, '开发 / 代码'],
			[1, '开发']
		]);
		const post = await (await call(database, { type: 'post', url: 'https://example.com' })).json();
		expect(post.categories.map((category: { id: number }) => category.id)).toEqual([5]);
	});
	it('only exposes published public duplicate titles and counts pending or reviewing submissions', async () => {
		const { database, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO items VALUES(1,'公开内容','published','public'),(2,'私有内容','published','private'),(3,'草稿标题','draft','public'); INSERT INTO item_meta VALUES(1,'site_url','https://example.com/reference/'),(2,'site_url','https://example.com/reference'),(3,'site_url','https://example.com/reference'); INSERT INTO submissions VALUES('pending','{\"url\":\"https://example.com/reference\"}'),('reviewing','{\"url\":\"https://example.com/reference/\"}'),('rejected','{\"url\":\"https://example.com/reference\"}'),('pending','bad-json')"
		);
		const body = await (await call(database, { type: 'site', url: 'https://example.com' })).json();
		expect(body.duplicate).toEqual({ published: ['公开内容'], pendingCount: 2 });
		expect(recordAiCall).toHaveBeenCalledWith(
			database,
			expect.objectContaining({
				origin: 'submission',
				stage: 'webpage',
				outcome: 'skipped',
				providerId: null
			})
		);
		expect(JSON.stringify(body)).not.toMatch(/私有内容|草稿标题/);
	});
	it.each([true, false])(
		'records actual AI outcomes separately from the webpage stage: %s',
		async (success) => {
			const { database } = fixture();
			vi.mocked(getEnabledAiProvider).mockResolvedValueOnce({
				id: 2,
				name: '主服务',
				model: 'model-a',
				apiKey: 'never-return-this-key',
				baseUrl: 'https://api.example.com/v1',
				timeoutMs: 30000,
				maxSourceChars: 8000,
				systemPrompt: 'prompt',
				revision: 'server-only'
			});
			if (!success)
				vi.mocked(generateSubmissionSuggestion).mockRejectedValueOnce(
					new AiGenerationError('密钥不可用', 'authentication')
				);
			const response = await call(database, { type: 'site', url: 'https://example.com' });
			expect(response.status).toBe(success ? 200 : 422);
			expect(recordAiCall).toHaveBeenCalledWith(
				database,
				expect.objectContaining({
					origin: 'submission',
					stage: 'generation',
					outcome: success ? 'success' : 'failed',
					providerId: 2,
					providerName: '主服务',
					model: 'model-a',
					aiDurationMs: expect.any(Number)
				})
			);
			expect(JSON.stringify(await response.json())).not.toContain('never-return-this-key');
		}
	);
});
