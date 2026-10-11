import type { NavigationItem } from '$lib/data/navigation';

export const SEARCH_QUERY_LIMIT = 200;
export const SEARCH_PAGE_SIZE = 24;
export const SEARCH_RECOMMENDATION_LIMIT = 8;
export const SEARCH_RECOMMENDATION_LENGTH = 20;
export const DEFAULT_SEARCH_RECOMMENDATIONS = ['AI 工具', '设计资源', '开发工具', '效率软件'];

export function normalizeSearchQuery(value: string) {
	return value.trim().slice(0, SEARCH_QUERY_LIMIT);
}

export function parseSearchPage(value: string | null) {
	if (!value || !/^[1-9]\d*$/.test(value)) return 1;
	const page = Number(value);
	return Number.isSafeInteger(page) ? page : 1;
}

export function searchPagination(total: number, requestedPage = 1) {
	const pageCount = Math.ceil(total / SEARCH_PAGE_SIZE);
	const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), Math.max(1, pageCount));
	return { total, page, pageCount, pageSize: SEARCH_PAGE_SIZE };
}

export function searchPageNumbers(page: number, pageCount: number): Array<number | null> {
	const numbers = [...new Set([1, page - 1, page, page + 1, pageCount])]
		.filter((value) => value >= 1 && value <= pageCount)
		.sort((a, b) => a - b);
	return numbers.flatMap((value, index) =>
		index && value - numbers[index - 1] > 1 ? [null, value] : [value]
	);
}

export function searchPageUrl(query: string, page: number) {
	const params = new URLSearchParams({ q: query });
	if (page > 1) params.set('page', String(page));
	return '/search?' + params.toString();
}

export function searchRank(item: NavigationItem, query: string): number | null {
	// Match SQLite NOCASE / LIKE's ASCII case folding in local preview data too.
	const fold = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
	const needle = fold(query);
	const title = fold(item.title);
	if (title === needle) return 0;
	if (title.startsWith(needle)) return 1;
	if (title.includes(needle)) return 2;
	if (fold(item.summary).includes(needle)) return 3;
	if (
		[item.category, ...item.tags.map((tag) => tag.name)].some((value) =>
			fold(value).includes(needle)
		)
	)
		return 4;
	return null;
}

export function searchRecommendations(value: unknown): string[] {
	if (!Array.isArray(value)) return [...DEFAULT_SEARCH_RECOMMENDATIONS];
	return [
		...new Set(
			value.flatMap((word) =>
				typeof word === 'string' && word.trim()
					? [word.trim().slice(0, SEARCH_RECOMMENDATION_LENGTH)]
					: []
			)
		)
	].slice(0, SEARCH_RECOMMENDATION_LIMIT);
}
