import { requireDatabase } from '$lib/server/db';
import { buildSitemapXml, listSitemapEntries } from '$lib/server/services/seo';
import { appConfig } from '$lib/config';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ platform }) =>
	new Response(
		buildSitemapXml(await listSitemapEntries(requireDatabase(platform), appConfig.url)),
		{
			headers: {
				'content-type': 'application/xml; charset=utf-8',
				'cache-control': 'public, max-age=3600'
			}
		}
	);
