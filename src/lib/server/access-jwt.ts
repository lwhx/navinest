/**
 * Verifies the Cloudflare Access JWT assertion (Cf-Access-Jwt-Assertion) against the
 * team domain's published JWKS, so access-mode authorization no longer relies on
 * trusting request headers injected by an assumed edge proxy.
 */
export type AccessJwtFailure =
	'malformed' | 'expired' | 'issuer' | 'audience' | 'signature' | 'key-unavailable';

export type AccessJwtResult = { ok: true; email: string } | { ok: false; reason: AccessJwtFailure };

export type AccessJwk = JsonWebKey & { kid?: string };

type AccessJwtHeader = { alg?: string; kid?: string };
type AccessJwtPayload = { exp?: unknown; iss?: unknown; aud?: unknown; email?: unknown };

const JWKS_CACHE_TTL_MS = 10 * 60_000;
const JWKS_TIMEOUT_MS = 5_000;
/** Access tokens are short-lived; a small leeway absorbs minor clock skew. */
const EXPIRY_LEEWAY_SECONDS = 30;

let jwksCache: { origin: string; keys: AccessJwk[]; fetchedAt: number } | null = null;

export function normalizeAccessTeamDomain(teamDomain: string): string {
	return teamDomain
		.trim()
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '');
}

function base64UrlBytes(segment: string): Uint8Array<ArrayBuffer> {
	const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function decodeSegment<T>(segment: string): T {
	return JSON.parse(new TextDecoder().decode(base64UrlBytes(segment))) as T;
}

async function loadJwks(origin: string, fetcher: typeof fetch): Promise<AccessJwk[]> {
	const cached = jwksCache;
	if (cached && cached.origin === origin && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS)
		return cached.keys;
	const response = await fetcher(`${origin}/cdn-cgi/access/certs`, {
		signal: AbortSignal.timeout(JWKS_TIMEOUT_MS)
	});
	if (!response.ok) {
		await response.body?.cancel().catch(() => undefined);
		throw new Error(`JWKS request failed with status ${response.status}`);
	}
	const document = (await response.json()) as { keys?: AccessJwk[] };
	const keys = Array.isArray(document.keys) ? document.keys : [];
	jwksCache = { origin, keys, fetchedAt: Date.now() };
	return keys;
}

/**
 * Checks signature (RS256 via JWKS), expiry, issuer and — when configured — audience,
 * and returns the verified email claim as the only trusted identity source.
 */
export async function verifyAccessAssertion(
	assertion: string,
	options: {
		teamDomain: string;
		aud?: string | null;
		fetcher?: typeof fetch;
		now?: Date;
	}
): Promise<AccessJwtResult> {
	const fetcher = options.fetcher ?? fetch;
	const parts = assertion.split('.');
	if (parts.length !== 3 || parts.some((part) => !part)) return { ok: false, reason: 'malformed' };
	let header: AccessJwtHeader;
	let payload: AccessJwtPayload;
	try {
		header = decodeSegment<AccessJwtHeader>(parts[0]);
		payload = decodeSegment<AccessJwtPayload>(parts[1]);
	} catch {
		return { ok: false, reason: 'malformed' };
	}
	if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid)
		return { ok: false, reason: 'malformed' };

	const origin = `https://${normalizeAccessTeamDomain(options.teamDomain)}`;
	let keys: AccessJwk[];
	try {
		keys = await loadJwks(origin, fetcher);
	} catch {
		return { ok: false, reason: 'key-unavailable' };
	}
	const jwk = keys.find((key) => key.kid === header.kid);
	if (!jwk) return { ok: false, reason: 'signature' };

	let key: CryptoKey;
	try {
		key = await crypto.subtle.importKey(
			'jwk',
			jwk,
			{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
			false,
			['verify']
		);
	} catch {
		return { ok: false, reason: 'signature' };
	}
	const valid = await crypto.subtle.verify(
		{ name: 'RSASSA-PKCS1-v1_5' },
		key,
		base64UrlBytes(parts[2]),
		new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
	);
	if (!valid) return { ok: false, reason: 'signature' };

	const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
	const exp = typeof payload.exp === 'number' ? payload.exp : 0;
	if (!exp || exp < nowSeconds - EXPIRY_LEEWAY_SECONDS) return { ok: false, reason: 'expired' };
	if (payload.iss !== origin) return { ok: false, reason: 'issuer' };
	if (options.aud) {
		const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
		if (!audiences.includes(options.aud)) return { ok: false, reason: 'audience' };
	}
	const email = typeof payload.email === 'string' ? payload.email.trim() : '';
	if (!email) return { ok: false, reason: 'malformed' };
	return { ok: true, email };
}
