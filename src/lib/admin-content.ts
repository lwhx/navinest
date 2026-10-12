import type { ContentType } from '$lib/types/content';

export const ADMIN_CONTENT_TYPES: Array<{ value: 'all' | ContentType; label: string }> = [
	{ value: 'all', label: '全部内容' },
	{ value: 'site', label: '网址' },
	{ value: 'post', label: '文章' },
	{ value: 'app', label: 'APP / 资源' },
	{ value: 'book', label: '书籍 / 影视' },
	{ value: 'bulletin', label: '公告' }
];

export type AdminContentFilters = {
	type: 'all' | ContentType;
	category: string;
	status: 'all' | 'published' | 'draft';
	visibility: 'all' | 'public' | 'private';
	q: string;
	page: number;
	mode: 'browse' | 'sort';
};

export function adminContentFilters(params: URLSearchParams): AdminContentFilters {
	const type = params.get('type');
	const category = params.get('category') ?? 'all';
	const page = Number(params.get('page') ?? 1);
	return {
		type: ADMIN_CONTENT_TYPES.some((entry) => entry.value === type)
			? (type as AdminContentFilters['type'])
			: 'all',
		category:
			category === 'none' || (/^[1-9]\d*$/.test(category) && Number.isSafeInteger(Number(category)))
				? category
				: 'all',
		status:
			params.get('status') === 'published' || params.get('status') === 'draft'
				? (params.get('status') as AdminContentFilters['status'])
				: 'all',
		visibility:
			params.get('visibility') === 'public' || params.get('visibility') === 'private'
				? (params.get('visibility') as AdminContentFilters['visibility'])
				: 'all',
		q: (params.get('q') ?? '').trim().slice(0, 160),
		page: Number.isSafeInteger(page) && page > 0 ? page : 1,
		mode: params.get('mode') === 'sort' ? 'sort' : 'browse'
	};
}

export function adminContentUrl(
	filters: AdminContentFilters,
	changes: Partial<AdminContentFilters> = {}
): string {
	const next = { ...filters, ...changes };
	const params = new URLSearchParams();
	for (const key of ['type', 'category', 'status', 'visibility'] as const)
		if (next[key] !== 'all') params.set(key, next[key]);
	if (next.q) params.set('q', next.q);
	if (next.mode === 'sort') params.set('mode', 'sort');
	else if (next.page > 1) params.set('page', String(next.page));
	return '/admin/items' + (params.size ? '?' + params.toString() : '');
}

export const BULK_CONTENT_ACTIONS = [
	{ value: 'publish', label: '发布' },
	{ value: 'draft', label: '转为草稿' },
	{ value: 'feature', label: '设为推荐' },
	{ value: 'unfeature', label: '取消推荐' }
] as const;
export type BulkContentAction = (typeof BULK_CONTENT_ACTIONS)[number]['value'];
