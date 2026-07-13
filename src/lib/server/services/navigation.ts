import type { NavigationItem } from '$lib/data/navigation';
import type { Item } from '$lib/types/content';

const accents = ['#ef6f4d', '#2f6fed', '#ff3e00', '#9b6bff', '#1f9cf0', '#2ca66f'];

export function itemUrl(item: Item): string | null {
	return item.meta.site_url ?? item.meta.app_download_url ?? item.meta.book_download_url ?? null;
}

export function toNavigationItem(item: Item): NavigationItem {
	return {
		type: item.type,
		slug: item.slug,
		title: item.title,
		url: itemUrl(item),
		category: item.category?.name ?? '未分类',
		summary: item.summary ?? '',
		tags: item.tags,
		accent: accents[(item.id - 1) % accents.length],
		iconFileId: item.iconFileId,
		coverFileId: item.coverFileId
	};
}
