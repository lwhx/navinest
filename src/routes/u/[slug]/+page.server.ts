import { error } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import { loadPublicShare } from '$lib/server/services/share-pages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
	const database = getDatabase(platform);
	const share = database ? await loadPublicShare(database, params.slug) : null;
	if (!share) throw error(404, '分享页不存在或未开启。');
	return { share };
};
