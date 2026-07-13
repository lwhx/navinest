import { appConfig } from '$lib/config';
import type { RequestHandler } from './$types';
const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api
Disallow: /user
Disallow: /login
Disallow: /contribute
Disallow: /go

Sitemap: ${appConfig.url}/sitemap.xml
`;
export const GET: RequestHandler = () =>
	new Response(body, {
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
	});
