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
	recordAiProviderTest
} from '$lib/server/services/ai-providers';
import { assertPublicFetchTarget } from '$lib/server/services/web-enrichment';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, params }) => {
	const id = parsePositiveId(params.id);
	if (!id) return json({ error: 'AI 服务 ID 无效。' }, { status: 400 });
	try {
		const provider = await getAiProviderById(
			requireDatabase(platform),
			platform?.env?.AI_CONFIG_ENCRYPTION_KEY ?? '',
			id
		);
		if (!provider) return json({ error: 'AI 服务不存在。' }, { status: 404 });
		await assertPublicFetchTarget(provider.baseUrl);
		const started = Date.now();
		await generateSubmissionSuggestion(provider, {
			fetchedUrl: 'https://example.com/',
			title: 'Example Navigation Tool',
			description: 'A test page for validating the configured AI service.',
			excerpt: 'This is untrusted test webpage content used only to verify structured JSON output.',
			siteName: 'Example',
			fetchedAt: new Date().toISOString()
		});
		await recordAiProviderTest(requireDatabase(platform), id, true, null);
		return json({ success: true, latencyMs: Date.now() - started, model: provider.model });
	} catch (error) {
		if (error instanceof AiProviderError || error instanceof AiGenerationError) {
			try {
				await recordAiProviderTest(requireDatabase(platform), id, false, error.message);
			} catch {
				/* Preserve the original test error. */
			}
			return json({ error: error.message }, { status: 422 });
		}
		console.error('AI provider test failed', error instanceof Error ? error.name : 'unknown');
		return json({ error: 'AI 服务测试失败。' }, { status: 500 });
	}
};
