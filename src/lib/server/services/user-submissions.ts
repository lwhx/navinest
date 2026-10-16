import type { Database, DatabaseValue } from '$lib/server/db';
import { contentDetailRoute } from '$lib/content-routing';
import type { ContentType } from '$lib/types/content';
import { categoryParentPath } from '$lib/category-parent-selection';
import { isContributionType } from '$lib/contribution-types';
import { listCategories } from './categories';
import { resubmissionSourceCondition } from './submission-resubmission';
import {
	USER_SUBMISSION_PAGE_SIZE,
	submissionId,
	userSubmissionFilters
} from '$lib/user-submissions';

function payload(raw: string) {
	try {
		const value: unknown = JSON.parse(raw);
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}
type Row = {
	id: number;
	type: string;
	title: string;
	status: string;
	review_message: string | null;
	created_at: string;
	updated_at: string;
	payload_json: string;
	can_resubmit: number;
	target_type: ContentType | null;
	target_slug: string | null;
	child_id: number | null;
	parent_id: number | null;
};
const safeJson = (alias: string) =>
	`CASE WHEN json_valid(${alias}.payload_json) THEN ${alias}.payload_json ELSE '{}' END`;
const columns = `source.id,source.type,source.title,source.status,source.review_message,source.created_at,source.updated_at,source.payload_json,
 CASE WHEN ${resubmissionSourceCondition} THEN 1 ELSE 0 END can_resubmit,
 target.type target_type,target.slug target_slug,
 (SELECT child.id FROM submissions child WHERE child.user_id=source.user_id AND CAST(json_extract(${safeJson('child')},'$.sourceSubmissionId') AS INTEGER)=source.id ORDER BY child.id DESC LIMIT 1) child_id,
 (SELECT parent.id FROM submissions parent WHERE parent.user_id=source.user_id AND parent.id=CAST(json_extract(${safeJson('source')},'$.sourceSubmissionId') AS INTEGER)) parent_id`;
const joins = `FROM submissions source LEFT JOIN items target ON target.id=source.target_item_id AND target.type=source.type
 AND target.status='published' AND target.visibility='public' AND source.status IN ('published','approved') AND source.review_token IS NULL
 AND COALESCE(json_extract(${safeJson('source')},'$._review.state'),'')<>'running'`;
function map(row: Row, full = false) {
	const parsed = payload(row.payload_json);
	const text = (key: string) => (typeof parsed?.[key] === 'string' ? (parsed[key] as string) : '');
	return {
		id: row.id,
		type: row.type,
		title: row.title,
		status: row.status,
		reviewMessage: row.review_message,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		payloadAvailable: parsed !== null,
		summary: text('summary'),
		url: text('url'),
		content: full ? text('content') : '',
		tagNames:
			full && Array.isArray(parsed?.tagNames)
				? [
						...new Set(parsed.tagNames.filter((tag): tag is string => typeof tag === 'string'))
					].slice(0, 8)
				: [],
		categoryId: submissionId(parsed?.userCategoryId),
		iconFileId: submissionId(parsed?.iconFileId),
		iconSource:
			parsed?.iconSource === 'auto' || parsed?.iconSource === 'manual' ? parsed.iconSource : null,
		canResubmit: row.can_resubmit === 1,
		parentId: row.parent_id,
		childId: row.child_id,
		publishedHref:
			row.target_type &&
			row.target_slug &&
			['site', 'post', 'app', 'book', 'bulletin'].includes(row.target_type)
				? contentDetailRoute(row.target_type).replace('[slug]', encodeURIComponent(row.target_slug))
				: null
	};
}
export async function getUserSubmission(database: Database, userId: number, id: number) {
	const row = (
		await database
			.prepare(`SELECT ${columns} ${joins} WHERE source.user_id=? AND source.id=? LIMIT 1`)
			.bind(userId, id)
			.all<Row>()
	).results[0];
	if (!row) return null;
	const detail = map(row, true);
	const [categories, icon] = await Promise.all([
		detail.categoryId ? listCategories(database, { visibleOnly: true }) : Promise.resolve([]),
		detail.iconFileId
			? database
					.prepare(
						"SELECT id FROM files WHERE id=? AND user_id=? AND bucket='FILES' AND mime_type LIKE 'image/%'"
					)
					.bind(detail.iconFileId, userId)
					.all<{ id: number }>()
			: Promise.resolve({ results: [] })
	]);
	const path = detail.categoryId
		? categoryParentPath(
				categories.filter((c) => c.type === detail.type),
				String(detail.categoryId)
			)
		: [];
	return {
		...detail,
		categoryPath: path?.map((part) => part.name).join(' / ') ?? null,
		iconAvailable: icon.results.length > 0
	};
}
export async function loadUserSubmissions(
	database: Database,
	userId: number,
	params: URLSearchParams
) {
	const filters = userSubmissionFilters(params),
		conditions = ['source.user_id=?'],
		values: DatabaseValue[] = [userId];
	if (filters.q) {
		conditions.push(
			`(source.title LIKE ? ESCAPE '\\' OR source.review_message LIKE ? ESCAPE '\\' OR json_extract(${safeJson('source')},'$.summary') LIKE ? ESCAPE '\\' OR json_extract(${safeJson('source')},'$.content') LIKE ? ESCAPE '\\' OR json_extract(${safeJson('source')},'$.url') LIKE ? ESCAPE '\\')`
		);
		const match = '%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%';
		values.push(match, match, match, match, match);
	}
	const counts = (
		await database
			.prepare(
				`SELECT source.status,COUNT(*) total FROM submissions source WHERE ${conditions.join(' AND ')} GROUP BY source.status`
			)
			.bind(...values)
			.all<{ status: string; total: number }>()
	).results;
	const summary = Object.fromEntries(counts.map((r) => [r.status, r.total]));
	if (filters.status === 'pending') conditions.push("source.status IN ('pending','reviewing')");
	else if (filters.status !== 'all') {
		conditions.push('source.status=?');
		values.push(filters.status);
	}
	const where = conditions.join(' AND ');
	const total =
		filters.status === 'all'
			? counts.reduce((sum, r) => sum + r.total, 0)
			: filters.status === 'pending'
				? (summary.pending ?? 0) + (summary.reviewing ?? 0)
				: (summary[filters.status] ?? 0);
	const pageCount = Math.max(1, Math.ceil(total / USER_SUBMISSION_PAGE_SIZE));
	filters.page = Math.min(filters.page, pageCount);
	const rows = (
		await database
			.prepare(
				`SELECT ${columns} ${joins} WHERE ${where} ORDER BY source.created_at DESC,source.id DESC LIMIT ? OFFSET ?`
			)
			.bind(...values, USER_SUBMISSION_PAGE_SIZE, (filters.page - 1) * USER_SUBMISSION_PAGE_SIZE)
			.all<Row>()
	).results;
	const submissions = rows.map((row) => map(row));
	const selected = filters.submission
		? await getUserSubmission(database, userId, filters.submission)
		: null;
	return {
		submissions,
		filters,
		total,
		pageCount,
		pageSize: USER_SUBMISSION_PAGE_SIZE,
		summary,
		selected,
		selectedUnavailable: Boolean(filters.submission && !selected)
	};
}
export async function loadResubmission(database: Database, userId: number, id: number) {
	const source = await getUserSubmission(database, userId, id);
	if (!source) return null;
	if (!source.canResubmit || !isContributionType(source.type)) return { source, draft: null };
	return {
		source,
		draft: {
			type: source.type,
			title: source.title,
			summary: source.summary,
			content: source.content,
			url: source.url,
			userCategoryId: source.categoryPath ? String(source.categoryId) : '',
			tagInput: source.tagNames.join('，'),
			iconFileId: source.iconAvailable ? String(source.iconFileId) : '',
			iconSource: source.iconAvailable ? (source.iconSource ?? 'manual') : ''
		}
	};
}
