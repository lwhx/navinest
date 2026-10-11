import type { ContentType } from '$lib/types/content';

const detailRoutes = {
	site: '/sites/[slug]',
	post: '/posts/[slug]',
	app: '/apps/[slug]',
	book: '/books/[slug]',
	bulletin: '/bulletins/[slug]'
} as const satisfies Record<ContentType, string>;

export function contentDetailRoute(type: ContentType) {
	return detailRoutes[type];
}

export const contentTypeLabels = {
	site: '网址',
	post: '文章',
	app: '软件',
	book: '书籍',
	bulletin: '公告'
} as const satisfies Record<ContentType, string>;
