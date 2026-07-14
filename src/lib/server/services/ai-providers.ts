import type { Database } from '$lib/server/db';
import { validateExternalTarget } from '$lib/server/safe-target';
import type { AiProviderRuntimeConfig } from '$lib/server/services/ai-generation';

export type AiProviderInput = {
	name: string;
	baseUrl: string;
	model: string;
	apiKey: string;
	timeoutMs: number;
	maxSourceChars: number;
	systemPrompt: string;
	isEnabled: boolean;
};

export class AiProviderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AiProviderError';
	}
}

type Row = {
	id: number;
	name: string;
	base_url: string;
	model: string;
	api_key_ciphertext: string;
	api_key_iv: string;
	key_hint: string;
	timeout_ms: number;
	max_source_chars: number;
	system_prompt: string;
	is_enabled: number;
	test_status: string;
	tested_at: string | null;
	test_error: string | null;
	created_at: string;
	updated_at: string;
};

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
	let binary: string;
	try {
		binary = atob(value);
	} catch {
		throw new AiProviderError('AI 配置加密密钥格式无效。');
	}
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

async function cryptoKey(masterKey: string): Promise<CryptoKey> {
	if (!masterKey) throw new AiProviderError('AI 配置加密密钥尚未配置。');
	const raw = base64ToBytes(masterKey);
	if (raw.length !== 32) throw new AiProviderError('AI 配置加密密钥必须是 32 字节。');
	return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(masterKey: string, value: string) {
	const key = await cryptoKey(masterKey),
		iv = crypto.getRandomValues(new Uint8Array(12)),
		ciphertext = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			key,
			new TextEncoder().encode(value)
		);
	return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

async function decrypt(masterKey: string, ciphertext: string, iv: string): Promise<string> {
	try {
		const key = await cryptoKey(masterKey),
			plain = await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: base64ToBytes(iv) },
				key,
				base64ToBytes(ciphertext)
			);
		return new TextDecoder().decode(plain);
	} catch (error) {
		if (error instanceof AiProviderError) throw error;
		throw new AiProviderError('AI API Key 解密失败。');
	}
}

function normalize(input: AiProviderInput, requireKey: boolean): AiProviderInput {
	const name = input.name.trim().slice(0, 80),
		model = input.model.trim().slice(0, 120),
		apiKey = input.apiKey.trim(),
		systemPrompt = input.systemPrompt.trim().slice(0, 4000),
		result = validateExternalTarget(input.baseUrl.trim());
	if (!name) throw new AiProviderError('AI 服务名称不能为空。');
	if (!result.valid) throw new AiProviderError(result.reason);
	const url = new URL(result.target);
	if (url.port && !['80', '443'].includes(url.port))
		throw new AiProviderError('AI 服务仅允许标准 HTTP 或 HTTPS 端口。');
	if (!model) throw new AiProviderError('AI 模型名称不能为空。');
	if (requireKey && !apiKey) throw new AiProviderError('新增AI服务时必须填写 API Key。');
	if (!systemPrompt) throw new AiProviderError('系统提示词不能为空。');
	return {
		name,
		baseUrl: result.target.replace(/\/$/, ''),
		model,
		apiKey,
		timeoutMs: Math.max(5_000, Math.min(Number(input.timeoutMs) || 30_000, 120_000)),
		maxSourceChars: Math.max(1_000, Math.min(Number(input.maxSourceChars) || 8_000, 30_000)),
		systemPrompt,
		isEnabled: Boolean(input.isEnabled)
	};
}

async function disableOthers(database: Database, exceptId: number) {
	await database.prepare('UPDATE ai_providers SET is_enabled=0 WHERE id<>?').bind(exceptId).all();
}

export async function createAiProvider(
	database: Database,
	masterKey: string,
	raw: AiProviderInput
) {
	const input = normalize(raw, true),
		secret = await encrypt(masterKey, input.apiKey),
		row = (
			await database
				.prepare(
					`INSERT INTO ai_providers(name,base_url,model,api_key_ciphertext,api_key_iv,key_hint,timeout_ms,max_source_chars,system_prompt,is_enabled) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id`
				)
				.bind(
					input.name,
					input.baseUrl,
					input.model,
					secret.ciphertext,
					secret.iv,
					input.apiKey.slice(-4),
					input.timeoutMs,
					input.maxSourceChars,
					input.systemPrompt,
					0
				)
				.all<{ id: number }>()
		).results[0];
	if (!row) throw new AiProviderError('AI 服务保存失败。');
	return row.id;
}

async function rowById(database: Database, id: number): Promise<Row | null> {
	return (
		(await database.prepare('SELECT * FROM ai_providers WHERE id=? LIMIT 1').bind(id).all<Row>())
			.results[0] ?? null
	);
}

export async function updateAiProvider(
	database: Database,
	masterKey: string,
	id: number,
	raw: AiProviderInput
) {
	const existing = await rowById(database, id);
	if (!existing) throw new AiProviderError('AI 服务不存在。');
	const input = normalize(raw, false),
		connectionChanged = Boolean(
			input.apiKey || input.baseUrl !== existing.base_url || input.model !== existing.model
		),
		secret = input.apiKey
			? await encrypt(masterKey, input.apiKey)
			: { ciphertext: existing.api_key_ciphertext, iv: existing.api_key_iv },
		hint = input.apiKey ? input.apiKey.slice(-4) : existing.key_hint;
	const row = (
		await database
			.prepare(
				`UPDATE ai_providers SET name=?,base_url=?,model=?,api_key_ciphertext=?,api_key_iv=?,key_hint=?,timeout_ms=?,max_source_chars=?,system_prompt=?,is_enabled=?,test_status=?,tested_at=?,test_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id`
			)
			.bind(
				input.name,
				input.baseUrl,
				input.model,
				secret.ciphertext,
				secret.iv,
				hint,
				input.timeoutMs,
				input.maxSourceChars,
				input.systemPrompt,
				connectionChanged ? 0 : existing.is_enabled,
				connectionChanged ? 'untested' : existing.test_status,
				connectionChanged ? null : existing.tested_at,
				connectionChanged ? null : existing.test_error,
				id
			)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new AiProviderError('AI 服务更新失败。');
}

export async function listAiProviders(database: Database) {
	const rows = (
		await database
			.prepare(
				'SELECT id,name,base_url,model,key_hint,timeout_ms,max_source_chars,system_prompt,is_enabled,test_status,tested_at,test_error,created_at,updated_at FROM ai_providers ORDER BY is_enabled DESC,id ASC'
			)
			.all<Omit<Row, 'api_key_ciphertext' | 'api_key_iv'>>()
	).results;
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		baseUrl: row.base_url,
		model: row.model,
		configured: true,
		keyHint: row.key_hint,
		timeoutMs: row.timeout_ms,
		maxSourceChars: row.max_source_chars,
		systemPrompt: row.system_prompt,
		isEnabled: Boolean(row.is_enabled),
		testStatus: row.test_status,
		testedAt: row.tested_at,
		testError: row.test_error,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	}));
}

export async function recordAiProviderTest(
	database: Database,
	id: number,
	success: boolean,
	error: string | null
) {
	const row = (
		await database
			.prepare(
				`UPDATE ai_providers SET test_status=?,tested_at=CURRENT_TIMESTAMP,test_error=?,is_enabled=CASE WHEN ?=1 THEN is_enabled ELSE 0 END,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id`
			)
			.bind(
				success ? 'success' : 'failed',
				success ? null : error?.slice(0, 500) || '测试失败',
				success ? 1 : 0,
				id
			)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new AiProviderError('AI 服务不存在。');
}

export async function enableAiProvider(database: Database, id: number) {
	const provider = await rowById(database, id);
	if (!provider) throw new AiProviderError('AI 服务不存在。');
	if (provider.test_status !== 'success')
		throw new AiProviderError('AI 服务必须先通过连接测试才能启用。');
	await disableOthers(database, id);
	const row = (
		await database
			.prepare(
				"UPDATE ai_providers SET is_enabled=1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND test_status='success' RETURNING id"
			)
			.bind(id)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new AiProviderError('AI 服务启用失败。');
}

export async function disableAiProvider(database: Database, id: number) {
	const row = (
		await database
			.prepare(
				'UPDATE ai_providers SET is_enabled=0,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id'
			)
			.bind(id)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new AiProviderError('AI 服务不存在。');
}

export async function getEnabledAiProvider(
	database: Database,
	masterKey: string
): Promise<
	(AiProviderRuntimeConfig & { id: number; maxSourceChars: number; name: string }) | null
> {
	const row = (
		await database
			.prepare('SELECT * FROM ai_providers WHERE is_enabled=1 ORDER BY id LIMIT 1')
			.all<Row>()
	).results[0];
	if (!row) return null;
	return {
		id: row.id,
		name: row.name,
		baseUrl: row.base_url,
		model: row.model,
		apiKey: await decrypt(masterKey, row.api_key_ciphertext, row.api_key_iv),
		timeoutMs: row.timeout_ms,
		maxSourceChars: row.max_source_chars,
		systemPrompt: row.system_prompt
	};
}

export async function getAiProviderById(
	database: Database,
	masterKey: string,
	id: number
): Promise<
	(AiProviderRuntimeConfig & { id: number; maxSourceChars: number; name: string }) | null
> {
	const row = await rowById(database, id);
	if (!row) return null;
	return {
		id: row.id,
		name: row.name,
		baseUrl: row.base_url,
		model: row.model,
		apiKey: await decrypt(masterKey, row.api_key_ciphertext, row.api_key_iv),
		timeoutMs: row.timeout_ms,
		maxSourceChars: row.max_source_chars,
		systemPrompt: row.system_prompt
	};
}

export async function deleteAiProvider(database: Database, id: number) {
	const row = (
		await database
			.prepare('DELETE FROM ai_providers WHERE id=? RETURNING id')
			.bind(id)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new AiProviderError('AI 服务不存在。');
}
