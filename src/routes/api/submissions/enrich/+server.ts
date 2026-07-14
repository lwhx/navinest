import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { getEnabledAiProvider, AiProviderError } from '$lib/server/services/ai-providers';
import {
	generateSubmissionSuggestion,
	AiGenerationError
} from '$lib/server/services/ai-generation';
import {
	assertPublicFetchTarget,
	fetchWebSnapshot,
	WebFetchError
} from '$lib/server/services/web-enrichment';
import { AiRateLimitError, assertAiRateLimit, recordAiUsage } from '$lib/server/services/ai-usage';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: '请先登录后再使用网页智能填充。' }, { status: 401 });
	const database = requireDatabase(platform);
	let providerId: number | null = null;
	try {
		const body = (await request.json()) as Record<string, unknown>,
			url = typeof body.url === 'string' ? body.url.trim() : '';
		if (!url || url.length > 2048) return json({ error: '请输入有效的网址。' }, { status: 400 });
		await assertAiRateLimit(database, locals.user.id);
		const provider = await getEnabledAiProvider(
				database,
				platform?.env?.AI_CONFIG_ENCRYPTION_KEY ?? ''
			),
			snapshot = await fetchWebSnapshot(url, {
				maxTextChars: provider?.maxSourceChars ?? 8_000
			});
		if (!provider) {
			await recordAiUsage(database, {
				userId: locals.user.id,
				action: 'enrich',
				providerId: null,
				success: true,
				errorCode: null
			});
			return json({ snapshot, suggestion: null, ai: { available: false as const } });
		}
		providerId = provider.id;
		await assertPublicFetchTarget(provider.baseUrl);
		const suggestion = await generateSubmissionSuggestion(provider, snapshot);
		await recordAiUsage(database, {
			userId: locals.user.id,
			action: 'enrich',
			providerId,
			success: true,
			errorCode: null
		});
		return json({
			snapshot,
			suggestion,
			ai: { available: true as const, provider: provider.name, model: provider.model }
		});
	} catch (error) {
		if (error instanceof AiRateLimitError)
			return json({ error: error.message }, { status: 429, headers: { 'retry-after': '5' } });
		try {
			await recordAiUsage(database, {
				userId: locals.user.id,
				action: 'enrich',
				providerId,
				success: false,
				errorCode: error instanceof Error ? error.name : 'UnknownError'
			});
		} catch {
			// Preserve the original enrichment error if audit logging fails.
		}
		if (
			error instanceof WebFetchError ||
			error instanceof AiGenerationError ||
			error instanceof AiProviderError
		)
			return json({ error: error.message }, { status: 422 });
		console.error('Submission enrichment failed', error instanceof Error ? error.name : 'unknown');
		return json({ error: '网页智能填充暂时不可用，请稍后重试或手动填写。' }, { status: 500 });
	}
};
