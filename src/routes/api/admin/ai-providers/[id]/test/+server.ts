import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { parsePositiveId } from '$lib/server/admin-mutations';
import {
	generateSubmissionSuggestion,
	AiGenerationError
} from '$lib/server/services/ai-generation';
import {
	AiProviderError,
	getAiProviderById,
	getAiProviderTestState,
	recordAiProviderTest
} from '$lib/server/services/ai-providers';
import { recordAiCall } from '$lib/server/services/ai-call-history';
import { aiFailure, type AiFailureCode } from '$lib/ai-service-status';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, params, locals, request, url }) => {
	if (!locals.admin) return json({ error: '需要管理员权限。' }, { status: 403 });
	if (request.headers.get('origin') !== url.origin)
		return json({ error: '请求来源无效。' }, { status: 403 });
	const id = parsePositiveId(params.id);
	if (!id) return json({ error: 'AI 服务 ID 无效。' }, { status: 400 });
	const database = requireDatabase(platform),
		started = Date.now();
	let provider: Awaited<ReturnType<typeof getAiProviderById>> = null;
	let testedState: Awaited<ReturnType<typeof getAiProviderTestState>> = null;
	let code: AiFailureCode | null = null,
		errorMessage = '',
		status = 200,
		aiStarted: number | null = null;
	try {
		testedState = await getAiProviderTestState(database, id);
		provider = await getAiProviderById(database, platform?.env?.AI_CONFIG_ENCRYPTION_KEY ?? '', id);
		if (!provider) return json({ error: 'AI 服务不存在。' }, { status: 404 });
		testedState = provider;
		aiStarted = Date.now();
		await generateSubmissionSuggestion(provider, {
			fetchedUrl: 'https://example.com/',
			title: 'Example Navigation Tool',
			description: 'A test page for validating the configured AI service.',
			excerpt: 'Untrusted example page for validating structured JSON output.',
			siteName: 'Example',
			fetchedAt: new Date().toISOString()
		});
		await recordAiProviderTest(database, id, true, null, provider.revision);
	} catch (error) {
		code =
			error instanceof AiProviderError || error instanceof AiGenerationError
				? error.code
				: 'unknown';
		errorMessage =
			error instanceof AiProviderError || error instanceof AiGenerationError
				? error.message
				: 'AI 服务测试失败。';
		status = code === 'stale' ? 409 : 422;
		if (testedState && code !== 'stale') {
			try {
				await recordAiProviderTest(
					database,
					id,
					false,
					aiFailure(code).label,
					testedState.revision
				);
			} catch (stateError) {
				code = stateError instanceof AiProviderError ? stateError.code : 'configuration';
				errorMessage =
					code === 'stale'
						? '配置已变化，测试结果未应用，请重新测试。'
						: '测试未通过，测试状态保存失败。请刷新核对后重试。';
				status = code === 'stale' ? 409 : 500;
			}
		}
	}
	const latencyMs = Date.now() - started;
	const historySaved = await recordAiCall(database, {
		providerId: testedState?.id,
		providerName: testedState?.name,
		model: testedState?.model,
		origin: 'test',
		stage: !provider || code === 'stale' ? 'configuration' : 'generation',
		outcome: code ? 'failed' : 'success',
		errorCode: code,
		durationMs: latencyMs,
		aiDurationMs: aiStarted === null ? null : Date.now() - aiStarted
	});
	return json(
		code
			? { error: errorMessage, code, advice: aiFailure(code).advice, latencyMs, historySaved }
			: { success: true, latencyMs, model: provider?.model, historySaved },
		{ status }
	);
};
