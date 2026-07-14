import type { Database } from '$lib/server/db';

export class AiRateLimitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AiRateLimitError';
	}
}

export async function assertAiRateLimit(database: Database, userId: number) {
	const row = (
		await database
			.prepare(
				`SELECT COUNT(*) AS window_count, MAX(created_at) AS latest FROM ai_usage_events WHERE user_id=? AND action='enrich' AND created_at>=datetime('now','-10 minutes')`
			)
			.bind(userId)
			.all<{ window_count: number; latest: string | null }>()
	).results[0];
	if ((row?.window_count ?? 0) >= 10)
		throw new AiRateLimitError('智能获取每 10 分钟最多使用 10 次，请稍后再试。');
	if (row?.latest) {
		const latest = Date.parse(row.latest.replace(' ', 'T') + 'Z');
		if (Number.isFinite(latest) && Date.now() - latest < 5_000)
			throw new AiRateLimitError('智能获取操作过于频繁，请等待 5 秒后再试。');
	}
}

export async function recordAiUsage(
	database: Database,
	input: {
		userId: number;
		action: 'enrich';
		providerId: number | null;
		success: boolean;
		errorCode: string | null;
	}
) {
	await database
		.prepare(
			'INSERT INTO ai_usage_events(user_id,action,provider_id,success,error_code) VALUES(?,?,?,?,?)'
		)
		.bind(
			input.userId,
			input.action,
			input.providerId,
			input.success ? 1 : 0,
			input.errorCode?.slice(0, 80) ?? null
		)
		.all();
}
