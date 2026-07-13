const csp = [
	"default-src 'self'",
	"base-uri 'self'",
	"object-src 'none'",
	"frame-ancestors 'none'",
	"form-action 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"font-src 'self' data:",
	"connect-src 'self'",
	"manifest-src 'self'",
	"worker-src 'self'"
].join('; ');
export const securityHeaders: Readonly<Record<string, string>> = {
	'content-security-policy': csp,
	'strict-transport-security': 'max-age=31536000; includeSubDomains',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
	'cross-origin-opener-policy': 'same-origin'
};
export function shouldPrivateNoStore(pathname: string): boolean {
	return (
		pathname === '/login' ||
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
