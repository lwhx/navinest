import { SUBMISSION_PAGE_SIZE, submissionQueueFilters } from '$lib/submission-queue';
import { reviewReceipt } from '$lib/submission-queue';
import type { DatabaseValue } from '$lib/server/db';
import { contentDetailRoute } from '$lib/content-routing';
import type { ContentType } from '$lib/types/content';
import type { Database } from '$lib/server/db';
import type { SubmissionInput } from '$lib/server/services/submissions';
import type { WebSnapshot } from '$lib/server/services/web-enrichment';
type Row = {
	id: number;
	user_id: number;
	type: string;
	title: string;
	payload_json: string;
	status: string;
	review_message: string | null;
	review_token: string | null;
	target_item_id: number | null;
	review_started_at: string | null;
	updated_at: string;
	target_id: number | null;
	target_type: string | null;
	target_slug: string | null;
	target_title: string | null;
	created_at: string;
	username: string;
	display_name: string;
};
const columns = `s.id,s.user_id,s.type,s.title,s.payload_json,s.status,s.review_message,s.created_at,s.updated_at,s.review_token,s.review_started_at,s.target_item_id,u.username,u.display_name,
 target.id target_id,target.type target_type,target.slug target_slug,target.title target_title`;
const joins = `FROM submissions s JOIN users u ON u.id=s.user_id
 LEFT JOIN items target ON target.id=s.target_item_id AND target.type=s.type AND target.status='published' AND target.visibility='public'`;
const order = `CASE WHEN s.status IN ('pending','reviewing') THEN 0 ELSE 1 END,s.created_at ASC,s.id ASC`;
function record(raw: string) {
	try {
		const value = JSON.parse(raw);
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}
function map(row: Row) {
	const parsed = record(row.payload_json);
	const clean = parsed ? { ...parsed } : {};
	for (const key of ['summary', 'content', 'url'])
		if (typeof clean[key] !== 'string') clean[key] = null;
	for (const key of ['tagNames'])
		clean[key] = Array.isArray(clean[key])
			? clean[key].filter((value: unknown) => typeof value === 'string').slice(0, 8)
			: [];
	const suggestion = clean.aiSuggestion;
	if (suggestion && typeof suggestion === 'object' && !Array.isArray(suggestion)) {
		const ai = { ...suggestion } as Record<string, unknown>;
		for (const key of [
			'title',
			'summary',
			'content',
			'provider',
			'model',
			'generatedAt',
			'categoryName',
			'categoryReason'
		])
			if (typeof ai[key] !== 'string') ai[key] = '';
		ai.tags = Array.isArray(ai.tags)
			? ai.tags.filter((value: unknown) => typeof value === 'string').slice(0, 8)
			: [];
		clean.aiSuggestion = ai;
	} else clean.aiSuggestion = null;
	if (
		!clean.webSnapshot ||
		typeof clean.webSnapshot !== 'object' ||
		Array.isArray(clean.webSnapshot)
	)
		clean.webSnapshot = null;
	for (const key of ['userCategoryId', 'iconFileId'])
		if (!Number.isSafeInteger(clean[key]) || Number(clean[key]) <= 0) clean[key] = null;
	if (clean.webSnapshot) {
		const web = { ...clean.webSnapshot } as Record<string, unknown>;
		for (const key of ['title', 'description', 'siteName', 'excerpt', 'fetchedUrl', 'fetchedAt'])
			if (typeof web[key] !== 'string') web[key] = '';
		clean.webSnapshot = web;
	}
	const payload = clean as {
		summary: string | null;
		content: string | null;
		url: string | null;
		userCategoryId?: number | null;
		iconFileId?: number | null;
		iconSource?: 'auto' | 'manual' | null;
		tagNames?: string[];
		webSnapshot?: WebSnapshot | null;
		aiSuggestion?: SubmissionInput['aiSuggestion'];
	};
	const receipt = reviewReceipt(parsed),
		processing =
			row.status === 'reviewing' ||
			(row.status === 'pending' && row.target_item_id != null) ||
			row.review_token != null ||
			receipt?.state === 'running';
	const kind = row.target_type;
	const publishedHref =
		['published', 'approved'].includes(row.status) &&
		!processing &&
		row.target_id &&
		row.target_slug &&
		['site', 'post', 'app', 'book', 'bulletin'].includes(kind ?? '')
			? contentDetailRoute(kind as ContentType).replace(
					'[slug]',
					encodeURIComponent(row.target_slug)
				)
			: null;
	return {
		id: row.id,
		userId: row.user_id,
		type: row.type,
		title: row.title,
		payload,
		payloadAvailable: parsed !== null,
		status: row.status,
		processing,
		receipt,
		reviewMessage: row.review_message,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		reviewStartedAt: row.review_started_at,
		publishedHref,
		publishedTitle: publishedHref ? row.target_title : null,
		user: { username: row.username, displayName: row.display_name }
	};
}
export async function getAdminSubmission(database: Database, id: number) {
	const { results } = await database
		.prepare(`SELECT ${columns} ${joins} WHERE s.id=? LIMIT 1`)
		.bind(id)
		.all<Row>();
	return results[0] ? map(results[0]) : null;
}
export async function loadSubmissionQueue(database: Database, params: URLSearchParams) {
	const filters = submissionQueueFilters(params),
		conditions: string[] = [],
		values: DatabaseValue[] = [];
	if (filters.q) {
		conditions.push(
			`(s.title LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR CASE WHEN json_valid(s.payload_json) THEN json_extract(s.payload_json,'$.url') ELSE '' END LIKE ? ESCAPE '\\')`
		);
		const match = '%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%';
		values.push(match, match, match, match);
	}
	const summaryWhere = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
	const summaryRows = (
		await database
			.prepare(
				`SELECT s.status,COUNT(*) total FROM submissions s JOIN users u ON u.id=s.user_id ${summaryWhere} GROUP BY s.status`
			)
			.bind(...values)
			.all<{ status: string; total: number }>()
	).results;
	const summary = Object.fromEntries(summaryRows.map((row) => [row.status, row.total]));
	if (filters.status === 'pending') conditions.push("s.status IN ('pending','reviewing')");
	else if (filters.status !== 'all') {
		conditions.push('s.status=?');
		values.push(filters.status);
	}
	const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
	const total =
		(
			await database
				.prepare(`SELECT COUNT(*) total FROM submissions s JOIN users u ON u.id=s.user_id ${where}`)
				.bind(...values)
				.all<{ total: number }>()
		).results[0]?.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / SUBMISSION_PAGE_SIZE));
	filters.page = Math.min(filters.page, pageCount);
	const submissions = (
		await database
			.prepare(`SELECT ${columns} ${joins} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
			.bind(...values, SUBMISSION_PAGE_SIZE, (filters.page - 1) * SUBMISSION_PAGE_SIZE)
			.all<Row>()
	).results.map(map);
	let selected = filters.submission ? null : (submissions[0] ?? null);
	let selectedPage: number | null = null;
	if (filters.submission) {
		const selectedWhere = [...conditions, 's.id=?'].join(' AND ');
		const row = (
			await database
				.prepare(`SELECT ${columns} ${joins} WHERE ${selectedWhere} LIMIT 1`)
				.bind(...values, filters.submission)
				.all<Row>()
		).results[0];
		if (row) {
			selected = map(row);
			const priority = ['pending', 'reviewing'].includes(row.status) ? 0 : 1;
			const prior = [
				...conditions,
				`(CASE WHEN s.status IN ('pending','reviewing') THEN 0 ELSE 1 END < ? OR (CASE WHEN s.status IN ('pending','reviewing') THEN 0 ELSE 1 END = ? AND (s.created_at < ? OR (s.created_at = ? AND s.id < ?))))`
			].join(' AND ');
			const before =
				(
					await database
						.prepare(
							`SELECT COUNT(*) total FROM submissions s JOIN users u ON u.id=s.user_id WHERE ${prior}`
						)
						.bind(...values, priority, priority, row.created_at, row.created_at, row.id)
						.all<{ total: number }>()
				).results[0]?.total ?? 0;
			selectedPage = Math.floor(before / SUBMISSION_PAGE_SIZE) + 1;
		}
	}
	return {
		submissions,
		selected,
		selectedPage,
		selectedUnavailable: Boolean(filters.submission && !selected),
		filters,
		summary,
		total,
		pageCount,
		pageSize: SUBMISSION_PAGE_SIZE
	};
}
// Retain the existing service entry point for callers needing the default first page.
export async function listAdminSubmissions(database: Database) {
	return (await loadSubmissionQueue(database, new URLSearchParams('status=all'))).submissions;
}

export async function userSubmissionLinks(database: Database, userId: number) {
	const rows = (
		await database
			.prepare(
				`SELECT s.id,target.type,target.slug FROM submissions s JOIN items target ON target.id=s.target_item_id AND target.type=s.type AND target.status='published' AND target.visibility='public'
 WHERE s.user_id=? AND s.status IN ('published','approved') AND s.review_token IS NULL AND COALESCE(json_extract(CASE WHEN json_valid(s.payload_json) THEN s.payload_json ELSE '{}' END,'$._review.state'),'')<>'running'
 ORDER BY s.created_at DESC,s.id DESC LIMIT 100`
			)
			.bind(userId)
			.all<{ id: number; type: ContentType; slug: string }>()
	).results;
	return Object.fromEntries(
		rows
			.filter((row) => ['site', 'post', 'app', 'book', 'bulletin'].includes(row.type))
			.map((row) => [
				row.id,
				contentDetailRoute(row.type).replace('[slug]', encodeURIComponent(row.slug))
			])
	);
}
