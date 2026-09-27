import { appConfig } from '$lib/config';
import { getDatabase } from '$lib/server/db';
import { loadSiteSettings } from '$lib/server/services/site-settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	const site = await loadSiteSettings(getDatabase(platform));
	const lines = [
		'User-agent: *',
		'Allow: /',
		'Disallow: /admin',
		'Disallow: /api',
		'Disallow: /user',
		'Disallow: /login',
		'Disallow: /contribute',
		'Disallow: /go'
	];
	if (site.robotsExtra) lines.push(...site.robotsExtra.split('\n').map((line) => line.trimEnd()));
	if (site.sitemapEnabled) lines.push('', `Sitemap: ${appConfig.url}/sitemap.xml`);
	return new Response(`${lines.join('\n')}\n`, {
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
	});
};
