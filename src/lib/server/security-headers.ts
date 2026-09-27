const CSP_DIRECTIVES = [
	"default-src 'self'",
	"base-uri 'self'",
	"object-src 'none'",
	"frame-ancestors 'none'",
	"form-action 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"font-src 'self' data:",
	"connect-src 'self'",
	"manifest-src 'self'",
	"worker-src 'self'"
];

function scriptSrc(nonce?: string) {
	return nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'";
}

/** Base64url nonce; inline scripts run only when they carry the request nonce. */
export function createCspNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
}

export function contentSecurityPolicy(nonce?: string): string {
	return [scriptSrc(nonce), ...CSP_DIRECTIVES].join('; ');
}

export const securityHeaders: Readonly<Record<string, string>> = {
	'content-security-policy': contentSecurityPolicy(),
	'strict-transport-security': 'max-age=31536000; includeSubDomains',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
	'cross-origin-opener-policy': 'same-origin'
};
/** Shared policy plus this request's nonce, so the inline bootstrap stays allowed. */
export function requestSecurityHeaders(nonce: string): Record<string, string> {
	return { ...securityHeaders, 'content-security-policy': contentSecurityPolicy(nonce) };
}

const SCRIPT_TAG = /<script(?![^>]*\bnonce=)/gi;

/** Stamps the request nonce on every script tag of a rendered document. */
export function withScriptNonce(html: string, nonce: string): string {
	if (!nonce || !html.includes('<script')) return html;
	return html.replace(SCRIPT_TAG, `<script nonce="${nonce}"`);
}

export function shouldPrivateNoStore(pathname: string): boolean {
	return (
		pathname === '/login' ||
		pathname === '/register' ||
		pathname === '/contribute' ||
		pathname === '/user' ||
		pathname.startsWith('/user/') ||
		pathname === '/admin' ||
		pathname.startsWith('/admin/') ||
		pathname === '/api/auth' ||
		pathname.startsWith('/api/auth/') ||
		pathname === '/api/user' ||
		pathname.startsWith('/api/user/') ||
		pathname === '/api/admin' ||
		pathname.startsWith('/api/admin/')
	);
}
