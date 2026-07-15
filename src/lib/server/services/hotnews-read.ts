import type { Database } from '$lib/server/db';
export async function listHotNews(database: Database) {
	const sources = (
		await database
			.prepare(
				'SELECT id,name,type,last_fetch_at,slug,description,icon,accent_color,surface_color,display_limit,layout,sort_order,show_description,last_error,last_success_at FROM hot_sources WHERE is_enabled=1 ORDER BY sort_order,id'
			)
			.all<{
				id: number;
				name: string;
				type: string;
				last_fetch_at: string | null;
				slug: string;
				description: string;
				icon: string;
				accent_color: string;
				surface_color: string;
				display_limit: number;
				layout: string;
				sort_order: number;
				show_description: number;
				last_error: string | null;
				last_success_at: string | null;
			}>()
	).results;
	return Promise.all(
		sources.map(async (source) => {
			const items = (
				await database
					.prepare(
						'SELECT rank,title,url,hot_value,extra_json,fetched_at FROM hot_items WHERE source_id=? ORDER BY rank,id LIMIT 100'
					)
					.bind(source.id)
					.all<{
						rank: number;
						title: string;
						url: string;
						hot_value: string | null;
						extra_json: string;
						fetched_at: string;
					}>()
			).results;
			return {
				id: source.id,
				name: source.name,
				type: source.type,
				lastFetchAt: source.last_fetch_at,
				slug: source.slug,
				description: source.description,
				icon: source.icon,
				accentColor: source.accent_color,
				surfaceColor: source.surface_color,
				displayLimit: source.display_limit,
				layout: source.layout,
				sortOrder: source.sort_order,
				showDescription: source.show_description === 1,
				lastError: source.last_error,
				lastSuccessAt: source.last_success_at,
				items: items.slice(0, source.display_limit).map((item) => ({
					rank: item.rank,
					title: item.title,
					url: item.url,
					hotValue: item.hot_value,
					extra: JSON.parse(item.extra_json),
					fetchedAt: item.fetched_at
				}))
			};
		})
	);
}
