export const MEDIA_PAGE_SIZE = 24;
export const MEDIA_KINDS = [
	['all', '全部格式'],
	['png', 'PNG'],
	['jpeg', 'JPEG'],
	['webp', 'WebP'],
	['gif', 'GIF'],
	['svg', 'SVG'],
	['ico', 'ICO'],
	['other', '其他']
] as const;
export type MediaFilters = {
	q: string;
	kind: string;
	usage: string;
	from: string;
	to: string;
	order: string;
	page: number;
};
function date(value: string | null) {
	return value &&
		/^\d{4}-\d{2}-\d{2}$/.test(value) &&
		Number.isFinite(Date.parse(value)) &&
		new Date(value).toISOString().slice(0, 10) === value
		? value
		: '';
}
export function mediaFilters(params = new URLSearchParams()): MediaFilters {
	const from = date(params.get('from')),
		to = date(params.get('to'));
	const page = Number(params.get('page'));
	return {
		q: (params.get('q') ?? '').trim().slice(0, 120),
		kind: MEDIA_KINDS.some(([key]) => key === params.get('kind')) ? params.get('kind')! : 'all',
		usage: ['used', 'unused'].includes(params.get('usage') ?? '') ? params.get('usage')! : 'all',
		from,
		to: to && from && to < from ? from : to,
		order: ['oldest', 'size'].includes(params.get('order') ?? '') ? params.get('order')! : 'newest',
		page: Number.isSafeInteger(page) && page > 0 ? page : 1
	};
}
export function mediaQuery(filters: MediaFilters, page = filters.page) {
	const params = new URLSearchParams();
	for (const key of ['q', 'kind', 'usage', 'from', 'to', 'order'] as const)
		if (
			filters[key] &&
			!((key === 'kind' || key === 'usage') && filters[key] === 'all') &&
			!(key === 'order' && filters[key] === 'newest')
		)
			params.set(key, filters[key]);
	if (page > 1) params.set('page', String(page));
	return params.toString();
}
export function mediaSize(size: number | null) {
	if (size === null) return '大小未知';
	return size < 1024
		? `${size} B`
		: size < 1024 * 1024
			? `${(size / 1024).toFixed(1)} KiB`
			: `${(size / 1024 / 1024).toFixed(1)} MiB`;
}
export function referenceUsage(usage: string) {
	return (
		(
			{
				icon: '内容图标',
				cover: '内容封面',
				avatar: '用户头像',
				profileCover: '资料封面',
				submission: '投稿图标'
			} as Record<string, string>
		)[usage] ?? usage
	);
}
