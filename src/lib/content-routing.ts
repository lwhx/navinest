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
