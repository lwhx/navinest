export type FilterableLink = {
	title: string;
	url: string;
	summary?: string | null;
	categoryName?: string | null;
	status?: string;
};

/** Host name for display/filtering; falls back to the raw value for unparsable URLs. */
export function linkHost(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function searchableText(link: FilterableLink): string {
	return [link.title, link.url, link.summary ?? '', link.categoryName ?? '', linkHost(link.url)]
		.join('\n')
		.toLowerCase();
}

/** Case-insensitive filter over title, URL, host, summary and category name. */
export function filterLinks<T extends FilterableLink>(links: T[], query: string): T[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return links;
	return links.filter((link) => searchableText(link).includes(needle));
}
