import { loadDetailPage } from '$lib/server/load-detail';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, platform, locals }) =>
	loadDetailPage(platform, 'book', params.slug, locals.user);
