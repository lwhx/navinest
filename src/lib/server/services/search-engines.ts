import { validSearchTemplate } from '$lib/search-source';
import type { Database } from '$lib/server/db';
import type { SearchEngine } from '$lib/types/content';

type SearchEngineRow = {
	id: number;
	group_key: string;
	name: string;
	key: string;
	url_template: string;
	placeholder: string | null;
	sort_order: number;
	is_enabled: number;
};

export async function listSearchEngines(
	database: Database,
	enabledOnly = true
): Promise<SearchEngine[]> {
	const statement = database.prepare(
		`SELECT id, group_key, name, key, url_template, placeholder, sort_order, is_enabled
		 FROM search_engines
		 ${enabledOnly ? 'WHERE is_enabled = 1' : ''}
		 ORDER BY sort_order ASC, name ASC, id ASC`
	);
	const { results } = await statement.all<SearchEngineRow>();

	return results
		.filter((row) => !enabledOnly || validSearchTemplate(row.url_template))
		.map((row) => ({
			id: row.id,
			groupKey: row.group_key,
			name: row.name,
			key: row.key,
			urlTemplate: row.url_template,
			placeholder: row.placeholder,
			sortOrder: row.sort_order,
			isEnabled: row.is_enabled === 1
		}));
}
