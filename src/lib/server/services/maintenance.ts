import type { Database } from '$lib/server/db';

export const DEFAULT_CRON_RUN_DAYS = 30;
export const DEFAULT_LOGIN_ATTEMPT_HOURS = 24;
export const DEFAULT_STALE_RESERVATION_MINUTES = 60;

export type MaintenanceOptions = {
	cronRunDays?: number;
	loginAttemptHours?: number;
	staleReservationMinutes?: number;
	now?: Date;
};

export type MaintenanceResult = {
	expiredSessions: number;
	staleLoginAttempts: number;
	prunedCronRuns: number;
	abandonedReservations: number;
};

function positive(value: number | undefined, fallback: number, minimum: number) {
	const normalized = Math.trunc(Number(value ?? fallback));
	return Number.isFinite(normalized) ? Math.max(minimum, normalized) : fallback;
}

async function affected(database: Database, sql: string, values: unknown[]) {
	const rows = (
		await database
			.prepare(sql)
			.bind(...(values as never[]))
			.all<unknown>()
	).results;
	return rows.length;
}

/**
 * Housekeeping for rows that are only useful while recent: expired sessions,
 * stale login throttling windows, old cron history and abandoned AI reservations.
 * Site content and user data are never touched.
 */
export async function runMaintenance(
	database: Database,
	options: MaintenanceOptions = {}
): Promise<MaintenanceResult> {
	const cronRunDays = positive(options.cronRunDays, DEFAULT_CRON_RUN_DAYS, 1);
	const loginAttemptHours = positive(options.loginAttemptHours, DEFAULT_LOGIN_ATTEMPT_HOURS, 1);
	const staleReservationMinutes = positive(
		options.staleReservationMinutes,
		DEFAULT_STALE_RESERVATION_MINUTES,
		5
	);
	const now = (options.now ?? new Date()).toISOString();
	const expiredSessions = await affected(
		database,
		'DELETE FROM user_sessions WHERE expires_at<=? RETURNING token_hash',
		[now]
	);
	const staleLoginAttempts = await affected(
		database,
		`DELETE FROM login_attempts WHERE (locked_until IS NULL OR locked_until<=datetime('now')) AND window_started_at<=datetime('now','-${loginAttemptHours} hours') RETURNING attempt_key`,
		[]
	);
	const prunedCronRuns = await affected(
		database,
		`DELETE FROM cron_runs WHERE status<>'running' AND started_at<=datetime('now','-${cronRunDays} days') RETURNING id`,
		[]
	);
	const abandonedReservations = await affected(
		database,
		`UPDATE ai_usage_events SET status='abandoned',reservation_token=NULL,finished_at=CURRENT_TIMESTAMP WHERE status='in_flight' AND created_at<=datetime('now','-${staleReservationMinutes} minutes') RETURNING id`,
		[]
	);
	return { expiredSessions, staleLoginAttempts, prunedCronRuns, abandonedReservations };
}
