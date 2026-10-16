import type { DatabaseValue } from '$lib/server/db';
import type { MessageFilters } from '$lib/messages';
export const messageJson = (alias = 'm') =>
	`CASE WHEN json_valid(${alias}.data_json) THEN CASE WHEN json_type(${alias}.data_json)='object' THEN ${alias}.data_json ELSE '{}' END ELSE '{}' END`;
export const visibleMessage = (alias = 'm') =>
	`json_extract(${messageJson(alias)},'$.withdrawnAt') IS NULL`;
export function messageConditions(filters: MessageFilters, admin = false) {
	const conditions: string[] = [],
		values: DatabaseValue[] = [];
	if (filters.q) {
		conditions.push("(m.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')");
		const match = '%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%';
		values.push(match, match);
	}
	if (filters.type !== 'all') {
		conditions.push('m.type=?');
		values.push(filters.type);
	}
	if (admin) {
		if (filters.status === 'sent') conditions.push(visibleMessage());
		else if (filters.status === 'withdrawn') conditions.push(`NOT (${visibleMessage()})`);
	} else {
		conditions.push(visibleMessage());
		if (filters.status !== 'all') {
			conditions.push('m.is_read=?');
			values.push(filters.status === 'read' ? 1 : 0);
		}
	}
	return { conditions, values };
}
