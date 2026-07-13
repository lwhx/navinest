import { error, type RequestEvent } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import {
	fallbackContentDetail,
	loadContentDetail,
	type ContentDetailData
} from '$lib/server/services/content-detail';
import type { ContentType } from '$lib/types/content';
import { isFavorite, recordFootprint } from '$lib/server/services/user-activity';
import { recordView } from '$lib/server/services/rankings';
import type { UserIdentity } from '$lib/server/user-auth';

export async function loadDetailPage(
	platform: RequestEvent['platform'],
	type: ContentType,
	slug: string,
	user: UserIdentity | null = null
): Promise<ContentDetailData & { isFavorite: boolean }> {
	const database = getDatabase(platform);
	let data: ContentDetailData | null;

	if (!database) {
		data = fallbackContentDetail(type, slug);
	} else {
		try {
			data = await loadContentDetail(database, type, slug);
		} catch (cause) {
			console.error(`Failed to load ${type} detail from D1; using fallback data.`, cause);
			data = fallbackContentDetail(type, slug);
		}
	}

	if (!data) error(404, 'Content not found');
	if (database && data.id !== null) await recordView(database, data.id);
	let favorite = false;
	if (database && user && data.id !== null) {
		await recordFootprint(database, user.id, data.id);
		favorite = await isFavorite(database, user.id, data.id);
	}
	return { ...data, isFavorite: favorite };
}
