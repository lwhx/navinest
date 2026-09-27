import type { Database } from '$lib/server/db';

export class AiRateLimitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AiRateLimitError';
	}
}

export async function reserveAiUsage(
	database: Database,
	userId: number,
	token: string = crypto.randomUUID()
) {
	const row = (
		await database
			.prepare(
				`INSERT INTO ai_usage_events(user_id,action,success,reservation_token,status)
				 SELECT ?,'enrich',0,?,'in_flight'
				 WHERE (SELECT COUNT(*) FROM ai_usage_events WHERE user_id=? AND action='enrich' AND created_at>=datetime('now','-10 minutes'))<10
				   AND NOT EXISTS(SELECT 1 FROM ai_usage_events WHERE user_id=? AND action='enrich' AND created_at>datetime('now','-5 seconds'))
				 RETURNING id`
			)
			.bind(userId, token, userId, userId)
			.all<{ id: number }>()
	).results[0];
	if (row) return { id: row.id, token };
	const count = Number(
		(
			await database
				.prepare(
					"SELECT COUNT(*) count FROM ai_usage_events WHERE user_id=? AND action='enrich' AND created_at>=datetime('now','-10 minutes')"
				)
				.bind(userId)
				.all<{ count: number }>()
		).results[0]?.count ?? 0
	);
	if (count >= 10) throw new AiRateLimitError('智能获取每 10 分钟最多使用 10 次，请稍后再试。');
	throw new AiRateLimitError('智能获取操作过于频繁，请等待 5 秒后再试。');
}

export async function finalizeAiUsage(
	database: Database,
	input: {
		token: string;
		providerId: number | null;
		success: boolean;
		errorCode: string | null;
	}
) {
	const row = (
		await database
			.prepare(
				`UPDATE ai_usage_events SET provider_id=?,success=?,error_code=?,status='completed',finished_at=CURRENT_TIMESTAMP
				 WHERE reservation_token=? AND status='in_flight' RETURNING id`
			)
			.bind(
				input.providerId,
				input.success ? 1 : 0,
				input.errorCode?.slice(0, 80) ?? null,
				input.token
			)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new Error('AI usage reservation is missing or already finalized.');
}
