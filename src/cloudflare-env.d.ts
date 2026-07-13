interface Env {
	CACHE: KVNamespace;
	FILES: R2Bucket;
	DB: D1Database;
	ASSETS: Fetcher;
	APP_NAME: 'NaviNest';
	PUBLIC_SITE_URL: 'https://nss.whks.de';
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
}
