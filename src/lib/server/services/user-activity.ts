import type { Database } from '$lib/server/db';
import { adjustDailyStat } from '$lib/server/services/rankings';

export class ActivityError extends Error {
	constructor(
		message = '内容不存在。',
		public readonly status: 404 = 404
	) {
		super(message);
		this.name = 'ActivityError';
	}
}

type ActivityRow = {
	id: number;
	type: string;
	title: string;
	slug: string;
	summary: string | null;
	created_at?: string;
	visited_at?: string;
};
export type UserActivityItem = {
	id: number;
	type: string;
	title: string;
	slug: string;
	summary: string | null;
	createdAt?: string;
	visitedAt?: string;
};
async function requirePublicItem(database: Database, itemId: number) {
	const row = (
		await database
			.prepare(
				"SELECT id FROM items WHERE id=? AND status='published' AND visibility='public' LIMIT 1"
			)
			.bind(itemId)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new ActivityError();
}
function map(row: ActivityRow): UserActivityItem {
	return {
		id: row.id,
		type: row.type,
		title: row.title,
		slug: row.slug,
		summary: row.summary ?? null,
		...(row.created_at ? { createdAt: row.created_at } : {}),
		...(row.visited_at ? { visitedAt: row.visited_at } : {})
	};
}
export async function setFavorite(database: Database, userId: number, itemId: number) {
	await requirePublicItem(database, itemId);
	const inserted = (
		await database
			.prepare(
				'INSERT INTO favorites(user_id,item_id) VALUES(?,?) ON CONFLICT(user_id,item_id) DO NOTHING RETURNING id'
			)
			.bind(userId, itemId)
			.all<{ id: number }>()
	).results[0];
	if (!inserted) return;
	try {
		await adjustDailyStat(database, itemId, 'favorites', 1);
	} catch (error) {
		await database.prepare('DELETE FROM favorites WHERE id=?').bind(inserted.id).all();
		throw error;
	}
}
export async function removeFavorite(database: Database, userId: number, itemId: number) {
	const removed = (
		await database
			.prepare('DELETE FROM favorites WHERE user_id=? AND item_id=? RETURNING id')
			.bind(userId, itemId)
			.all<{ id: number }>()
	).results[0];
	if (!removed) return;
	try {
		await adjustDailyStat(database, itemId, 'favorites', -1);
	} catch (error) {
		await database
			.prepare('INSERT INTO favorites(id,user_id,item_id) VALUES(?,?,?)')
			.bind(removed.id, userId, itemId)
			.all();
		throw error;
	}
}
export async function isFavorite(database: Database, userId: number, itemId: number) {
	return Boolean(
		(
			await database
				.prepare('SELECT id FROM favorites WHERE user_id=? AND item_id=? LIMIT 1')
				.bind(userId, itemId)
				.all<{ id: number }>()
		).results[0]
	);
}
export async function listFavorites(database: Database, userId: number) {
	const rows = (
		await database
			.prepare(
				"SELECT i.id,i.type,i.title,i.slug,i.summary,f.created_at FROM favorites f JOIN items i ON i.id=f.item_id WHERE f.user_id=? AND i.status='published' AND i.visibility='public' ORDER BY f.created_at DESC,f.id DESC LIMIT 100"
			)
			.bind(userId)
			.all<ActivityRow>()
	).results;
	return rows.map(map);
}
export async function recordFootprint(
	database: Database,
	userId: number,
	itemId: number,
	now = new Date()
) {
	await requirePublicItem(database, itemId);
	await database
		.prepare(
			'INSERT INTO footprints(user_id,item_id,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET visited_at=excluded.visited_at'
		)
		.bind(userId, itemId, now.toISOString())
		.all();
}
export async function listFootprints(database: Database, userId: number) {
	const rows = (
		await database
			.prepare(
				"SELECT i.id,i.type,i.title,i.slug,i.summary,f.visited_at FROM footprints f JOIN items i ON i.id=f.item_id WHERE f.user_id=? AND i.status='published' AND i.visibility='public' ORDER BY f.visited_at DESC,f.id DESC LIMIT 100"
			)
			.bind(userId)
			.all<ActivityRow>()
	).results;
	return rows.map(map);
}
