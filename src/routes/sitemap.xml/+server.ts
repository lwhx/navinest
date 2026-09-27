import { requireDatabase } from '$lib/server/db';
import { buildSitemapXml, listSitemapEntries } from '$lib/server/services/seo';
import { loadSiteSettings } from '$lib/server/services/site-settings';
import { appConfig } from '$lib/config';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ platform }) => {
	const site = await loadSiteSettings(requireDatabase(platform));
	if (!site.sitemapEnabled)
		return new Response('<!-- sitemap disabled -->', {
			status: 404,
			headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' }
		});
	return new Response(
		buildSitemapXml(await listSitemapEntries(requireDatabase(platform), appConfig.url)),
		{
			headers: {
				'content-type': 'application/xml; charset=utf-8',
				'cache-control': 'public, max-age=3600'
			}
		}
	);
};
