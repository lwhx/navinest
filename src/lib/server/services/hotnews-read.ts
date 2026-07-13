import type { Database } from '$lib/server/db';
export async function listHotNews(database: Database) {
	const sources = (
		await database
			.prepare(
				'SELECT id,name,type,last_fetch_at FROM hot_sources WHERE is_enabled=1 ORDER BY name,id'
			)
			.all<{ id: number; name: string; type: string; last_fetch_at: string | null }>()
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
				items: items.map((item) => ({
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
