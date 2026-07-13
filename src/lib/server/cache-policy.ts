export type CachePolicy = 'identity-page' | 'rankings' | 'realtime';

const policies: Record<CachePolicy, string> = {
	'identity-page': 'private, no-store',
	rankings: 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
	realtime: 'no-store'
};

export function cacheControlFor(policy: CachePolicy): string {
	return policies[policy];
}
