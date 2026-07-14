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
	created_at: string;
	username: string;
	display_name: string;
};
export async function listAdminSubmissions(database: Database) {
	const rows = (
		await database
			.prepare(
				`SELECT s.id,s.user_id,s.type,s.title,s.payload_json,s.status,s.review_message,s.created_at,u.username,u.display_name FROM submissions s JOIN users u ON u.id=s.user_id ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END,s.created_at ASC,s.id ASC LIMIT 200`
			)
			.all<Row>()
	).results;
	return rows.map((row) => ({
		id: row.id,
		userId: row.user_id,
		type: row.type,
		title: row.title,
		payload: JSON.parse(row.payload_json) as {
			summary: string | null;
			content: string | null;
			url: string | null;
			userCategoryId?: number | null;
			iconFileId?: number | null;
			iconSource?: 'auto' | 'manual' | null;
			tagNames?: string[];
			webSnapshot?: WebSnapshot | null;
			aiSuggestion?: SubmissionInput['aiSuggestion'];
		},
		status: row.status,
		reviewMessage: row.review_message,
		createdAt: row.created_at,
		user: { username: row.username, displayName: row.display_name }
	}));
}
