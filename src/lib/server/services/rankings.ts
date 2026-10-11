import type { ContentType } from '$lib/types/content';
import type { Database, DatabaseValue } from '$lib/server/db';

export type RankingPeriod = 'day' | 'week' | 'month' | 'total';
type Counter = 'views' | 'likes' | 'favorites';
export class RankingError extends Error {
	constructor(message = '内容不存在。') {
		super(message);
		this.name = 'RankingError';
	}
}
function day(date: Date) {
	return date.toISOString().slice(0, 10);
}
async function requirePublic(database: Database, itemId: number) {
	const row = (
		await database
			.prepare(
				"SELECT id FROM items WHERE id=? AND status='published' AND visibility='public' LIMIT 1"
			)
			.bind(itemId)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new RankingError();
}
export async function adjustDailyStat(
	database: Database,
	itemId: number,
	counter: Counter,
	delta: number,
	now = new Date()
) {
	await requirePublic(database, itemId);
	const column = counter;
	await database
		.prepare(
			`INSERT INTO stats_daily(item_id,date,${column}) VALUES(?,?,MAX(0,?)) ON CONFLICT(item_id,date) DO UPDATE SET ${column}=MAX(0,${column}+?)`
		)
		.bind(itemId, day(now), delta, delta)
		.all();
}
export async function recordView(database: Database, itemId: number, now = new Date()) {
	await adjustDailyStat(database, itemId, 'views', 1, now);
}
function start(period: RankingPeriod, now: Date) {
	if (period === 'total') return null;
	if (period === 'day') return day(now);
	const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	if (period === 'week') date.setUTCDate(date.getUTCDate() - 6);
	else date.setUTCDate(1);
	return day(date);
}
type Row = {
	id: number;
	type: ContentType;
	title: string;
	slug: string;
	views: number;
	likes: number;
	favorites: number;
	score: number;
};
export async function listRankings(
	database: Database,
	period: RankingPeriod,
	now = new Date(),
	limit = 50
) {
	const from = start(period, now),
		values: DatabaseValue[] = [];
	const dateFilter = from ? 'AND s.date>=?' : '';
	if (from) values.push(from);
	values.push(Math.min(Math.max(Math.trunc(limit), 1), 100));
	const rows = (
		await database
			.prepare(
				`SELECT i.id,i.type,i.title,i.slug,COALESCE(SUM(s.views),0) views,COALESCE(SUM(s.likes),0) likes,COALESCE(SUM(s.favorites),0) favorites,COALESCE(SUM(s.views+s.likes*2+s.favorites*3),0) score FROM items i JOIN stats_daily s ON s.item_id=i.id WHERE i.status='published' AND i.visibility='public' ${dateFilter} GROUP BY i.id,i.type,i.title,i.slug HAVING score>0 ORDER BY score DESC,favorites DESC,views DESC,i.title ASC LIMIT ?`
			)
			.bind(...values)
			.all<Row>()
	).results;
	return rows;
}
