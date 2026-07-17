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
import { AiRateLimitError, finalizeAiUsage, reserveAiUsage } from '$lib/server/services/ai-usage';
import { listCategories } from '$lib/server/services/categories';
import type { ContentType } from '$lib/types/content';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: '请先登录后再使用网页智能填充。' }, { status: 401 });
	const database = requireDatabase(platform);
	let providerId: number | null = null,
		reservationToken: string | null = null;
	try {
		const body = (await request.json()) as Record<string, unknown>,
			url = typeof body.url === 'string' ? body.url.trim() : '',
			type = ['site', 'post', 'app', 'book'].includes(String(body.type))
				? (String(body.type) as ContentType)
				: 'site';
		if (!url || url.length > 2048) return json({ error: '请输入有效的网址。' }, { status: 400 });
		reservationToken = (await reserveAiUsage(database, locals.user.id)).token;
		const provider = await getEnabledAiProvider(
				database,
				platform?.env?.AI_CONFIG_ENCRYPTION_KEY ?? ''
			),
			categories = (await listCategories(database, { type, visibleOnly: true })).map(
				(category) => ({
					id: category.id,
					name: category.name,
					description: category.description
				})
			),
			snapshot = await fetchWebSnapshot(url, {
				maxTextChars: provider?.maxSourceChars ?? 8_000
			}),
			published = (
				await database
					.prepare(
						"SELECT i.title FROM item_meta m JOIN items i ON i.id=m.item_id WHERE m.meta_key IN ('site_url','app_download_url','book_download_url') AND rtrim(m.meta_value,'/')=rtrim(?,'/') LIMIT 5"
					)
					.bind(snapshot.fetchedUrl)
					.all<{ title: string }>()
			).results.map((row) => row.title),
			pendingCount = Number(
				(
					await database
						.prepare(
							"SELECT COUNT(*) count FROM submissions WHERE status='pending' AND rtrim(json_extract(payload_json,'$.url'),'/')=rtrim(?,'/')"
						)
						.bind(snapshot.fetchedUrl)
						.all<{ count: number }>()
				).results[0]?.count ?? 0
			),
			duplicate = { published, pendingCount };
		if (!provider) {
			await finalizeAiUsage(database, {
				token: reservationToken,
				providerId: null,
				success: true,
				errorCode: null
			});
			reservationToken = null;
			return json({
				snapshot,
				suggestion: null,
				categories,
				duplicate,
				ai: { available: false as const }
			});
		}
		providerId = provider.id;
		await assertPublicFetchTarget(provider.baseUrl);
		const suggestion = await generateSubmissionSuggestion(provider, snapshot, fetch, categories);
		await finalizeAiUsage(database, {
			token: reservationToken,
			providerId,
			success: true,
			errorCode: null
		});
		reservationToken = null;
		return json({
			snapshot,
			suggestion,
			categories,
			duplicate,
			ai: { available: true as const, provider: provider.name, model: provider.model }
		});
	} catch (error) {
		if (error instanceof AiRateLimitError)
			return json({ error: error.message }, { status: 429, headers: { 'retry-after': '5' } });
		if (reservationToken)
			try {
				await finalizeAiUsage(database, {
					token: reservationToken,
					providerId,
					success: false,
					errorCode: error instanceof Error ? error.name : 'UnknownError'
				});
			} catch {
				// Preserve the original enrichment error if audit finalization fails.
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
