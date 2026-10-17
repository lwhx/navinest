import { validateExternalTarget } from '$lib/safe-target';
import { normalizeSearchQuery } from '$lib/search';

export const INTERNAL_SEARCH_TEMPLATE = '/search?q={query}';
/** Resolve a fixed origin and exactly one encoded keyword slot; no network request. */
export function searchSourcePreview(template: string, query: string) {
	const value = template.trim();
	if (
		value.length > 2000 ||
		value.split('{query}').length !== 2 ||
		/[{}]/.test(value.replace('{query}', ''))
	)
		return { valid: false as const, error: '模板必须且只能包含一个 {query}，不能包含其他占位符。' };
	const keyword = normalizeSearchQuery(query);
	if (!keyword) return { valid: false as const, error: '请输入用于预览的搜索词。' };
	if (value === INTERNAL_SEARCH_TEMPLATE)
		return {
			valid: true as const,
			target: value.replace('{query}', encodeURIComponent(keyword)),
			host: '站内搜索',
			keyword,
			internal: true
		};
	// The keyword may belong to a path, query or fragment, never the origin/credentials.
	const marker = 'navinest-search-slot';
	let parsed: URL;
	try {
		parsed = new URL(value.replace('{query}', marker));
	} catch {
		return { valid: false as const, error: '请输入有效的公网 HTTP/HTTPS 搜索地址。' };
	}
	const authority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1];
	if (!authority || authority.includes('{query}'))
		return {
			valid: false as const,
			error: '搜索词占位符只能放在路径、查询参数或片段中，不能改变目标站点。'
		};
	const checked = validateExternalTarget(value.replace('{query}', encodeURIComponent(keyword)));
	if (!checked.valid) return { valid: false as const, error: checked.reason };
	if (new URL(checked.target).origin !== parsed.origin)
		return { valid: false as const, error: '搜索模板不能随关键词改变目标站点。' };
	return {
		valid: true as const,
		target: checked.target,
		host: checked.host,
		keyword,
		internal: false
	};
}
export function validSearchTemplate(template: string) {
	return searchSourcePreview(template, '导航巢').valid;
}
export function searchSourceListUrl(
	params: URLSearchParams,
	changes: Record<string, string | null> = {}
) {
	const result = new URLSearchParams();
	for (const key of ['q', 'group', 'status', 'page']) {
		const value = params.get(key);
		if (value) result.set(key, value);
	}
	for (const [key, value] of Object.entries(changes)) {
		if (value) result.set(key, value);
		else result.delete(key);
	}
	return '/admin/search-engines' + (result.size ? '?' + result.toString() : '');
}
