import type { Database } from '$lib/server/db';
import type { HomeModule } from '$lib/types/content';
type ModuleRow = {
	id: number;
	type: HomeModule['type'];
	title: string;
	config_json: string;
	sort_order: number;
};
type PopularRow = {
	id: number;
	type: string;
	title: string;
	slug: string;
	views: number;
	favorites: number;
	score: number;
};
type HotRow = {
	source: string;
	rank: number;
	title: string;
	url: string;
	hot_value: string | null;
};
async function count(database: Database, table: 'items' | 'categories' | 'users', where: string) {
	return (
		(
			await database
				.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${where}`)
				.all<{ count: number }>()
		).results[0]?.count ?? 0
	);
}
export async function loadHomeDashboard(database: Database) {
	const [moduleRows, items, categories, users, popular, hotnews] = await Promise.all([
		database
			.prepare(
				'SELECT id,type,title,config_json,sort_order FROM home_modules WHERE is_enabled=1 ORDER BY sort_order,id'
			)
			.all<ModuleRow>(),
		count(database, 'items', "status='published' AND visibility='public'"),
		count(database, 'categories', 'is_visible=1'),
		count(database, 'users', "status='active'"),
		database
			.prepare(
				`SELECT i.id,i.type,i.title,i.slug,COALESCE(SUM(s.views),0) views,COALESCE(SUM(s.favorites),0) favorites,COALESCE(SUM(s.views+s.likes*2+s.favorites*3),0) score FROM items i LEFT JOIN stats_daily s ON s.item_id=i.id WHERE i.status='published' AND i.visibility='public' GROUP BY i.id,i.type,i.title,i.slug ORDER BY score DESC,i.title LIMIT 12`
			)
			.all<PopularRow>(),
		database
			.prepare(
				`SELECT s.name source,i.rank,i.title,i.url,i.hot_value FROM hot_items i JOIN hot_sources s ON s.id=i.source_id WHERE s.is_enabled=1 ORDER BY s.name,i.rank,i.id LIMIT 10`
			)
			.all<HotRow>()
	]);
	return {
		modules: moduleRows.results.map((x) => ({
			id: x.id,
			type: x.type,
			title: x.title,
			config: JSON.parse(x.config_json) as Record<string, unknown>,
			sortOrder: x.sort_order
		})),
		stats: { items, categories, users },
		popular: popular.results,
		hotnews: hotnews.results.map((x) => ({
			source: x.source,
			rank: x.rank,
			title: x.title,
			url: x.url,
			hotValue: x.hot_value
		}))
	};
}
