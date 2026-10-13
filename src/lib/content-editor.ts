export function suggestedContentSlug(title: string, url: string, suffix: string): string {
	let source = title;
	if (url) {
		try {
			source = new URL(url).hostname.replace(/^www\./, '');
		} catch {
			/* Use title. */
		}
	}
	const base =
		source
			.normalize('NFKD')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 60)
			.replace(/-$/, '') || 'content';
	return `${base}-${
		suffix
			.replace(/[^a-z0-9]/gi, '')
			.toLowerCase()
			.slice(0, 12) || 'draft'
	}`;
}
