export const GITHUB_RETURN_COOKIE = 'navinest_github_return';

/** Only return to an admin page on this site; all other targets go home. */
export function adminLoginReturnTo(value: string | null | undefined): string {
	if (!value || value.length > 2048 || !value.startsWith('/')) return '/';
	try {
		const decoded = decodeURIComponent(value);
		if (
			decoded.includes('\\') ||
			[...decoded].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
		)
			return '/';
		const url = new URL(value, 'https://navinest.invalid');
		if (url.origin !== 'https://navinest.invalid') return '/';
		if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return '/';
		return url.pathname + url.search;
	} catch {
		return '/';
	}
}
