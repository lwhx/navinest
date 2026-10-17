import type { Database, DatabaseValue } from '$lib/server/db';
import type { AiFailureCode } from '$lib/ai-service-status';
export type AiCallRecord = {
	providerId?: number | null;
	providerName?: string | null;
	model?: string | null;
	origin: 'test' | 'submission';
	stage: 'configuration' | 'webpage' | 'generation';
	outcome: 'success' | 'failed' | 'skipped';
	errorCode?: AiFailureCode | null;
	durationMs: number;
	aiDurationMs?: number | null;
};
// Only bounded metadata is persisted. Never store prompts, URLs, keys or upstream bodies.
export async function recordAiCall(database: Database, input: AiCallRecord): Promise<boolean> {
	try {
		await database
			.prepare(
				`INSERT INTO ai_service_calls(provider_id,provider_name,model,origin,stage,outcome,error_code,duration_ms,ai_duration_ms) VALUES((SELECT id FROM ai_providers WHERE id=?),?,?,?,?,?,?,?,?)`
			)
			.bind(
				input.providerId ?? null,
				input.providerName?.slice(0, 80) ?? null,
				input.model?.slice(0, 120) ?? null,
				input.origin,
				input.stage,
				input.outcome,
				input.errorCode ?? null,
				Math.max(0, Math.round(input.durationMs)),
				input.aiDurationMs == null ? null : Math.max(0, Math.round(input.aiDurationMs))
			)
			.all();
		return true;
	} catch {
		console.error('AI call history write failed');
		return false;
	}
}
export async function listAiCalls(database: Database, params: URLSearchParams) {
	const origin = ['test', 'submission'].includes(params.get('origin') ?? '')
		? params.get('origin')!
		: '';
	const outcome = ['success', 'failed', 'skipped'].includes(params.get('outcome') ?? '')
		? params.get('outcome')!
		: '';
	const providerId =
		/^\d+$/.test(params.get('provider') ?? '') &&
		Number.isSafeInteger(Number(params.get('provider')))
			? params.get('provider')!
			: '';
	const conditions: string[] = [];
	const values: DatabaseValue[] = [];
	if (origin) {
		conditions.push('origin=?');
		values.push(origin);
	}
	if (outcome) {
		conditions.push('outcome=?');
		values.push(outcome);
	}
	if (providerId) {
		conditions.push('provider_id=?');
		values.push(Number(providerId));
	}
	const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
	const total = Number(
		(
			await database
				.prepare('SELECT COUNT(*) total FROM ai_service_calls' + where)
				.bind(...values)
				.all<{ total: number }>()
		).results[0]?.total ?? 0
	);
	const pages = Math.max(1, Math.ceil(total / 20));
	const requested = Number(params.get('page'));
	const page = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
	const rows = (
		await database
			.prepare(
				'SELECT id,provider_name,model,origin,stage,outcome,error_code,duration_ms,ai_duration_ms,created_at FROM ai_service_calls' +
					where +
					' ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?'
			)
			.bind(...values, (page - 1) * 20)
			.all<{
				id: number;
				provider_name: string | null;
				model: string | null;
				origin: string;
				stage: string;
				outcome: string;
				error_code: string | null;
				duration_ms: number;
				ai_duration_ms: number | null;
				created_at: string;
			}>()
	).results;
	return { rows, total, page, pages, filters: { origin, outcome, provider: providerId } };
}
