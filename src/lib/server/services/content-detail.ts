import {
	categories as fallbackCategories,
	navigationItems as fallbackItems
} from '$lib/data/navigation';
import type { Database } from '$lib/server/db';
import { getItemBySlug } from '$lib/server/services/items';
import { itemUrl } from '$lib/server/services/navigation';
import type { ContentType, Item } from '$lib/types/content';

export type ContentDetailData = {
	id: number | null;
	type: ContentType;
	title: string;
	slug: string;
	summary: string;
	content: string;
	category: { name: string; slug: string } | null;
	tags: Array<{ name: string; slug: string }>;
	meta: Record<string, string>;
	externalUrl: string | null;
	source: 'database' | 'fallback';
};

function toDetail(item: Item): ContentDetailData {
	return {
		id: item.id,
		type: item.type,
		title: item.title,
		slug: item.slug,
		summary: item.summary ?? '',
		content: item.content ?? '',
		category: item.category ? { name: item.category.name, slug: item.category.slug } : null,
		tags: item.tags,
		meta: item.meta,
		externalUrl: itemUrl(item),
		source: 'database'
	};
}

export async function loadContentDetail(
	database: Database,
	type: ContentType,
	slug: string
): Promise<ContentDetailData | null> {
	const item = await getItemBySlug(database, type, slug);
	return item ? toDetail(item) : null;
}

export function fallbackContentDetail(type: ContentType, slug: string): ContentDetailData | null {
	const item = fallbackItems.find((entry) => entry.type === type && entry.slug === slug);
	if (!item) return null;

	const category = fallbackCategories.find((entry) => entry.name === item.category);
	return {
		id: null,
		type,
		title: item.title,
		slug,
		summary: item.summary,
		content: item.summary,
		category: category ? { name: category.name, slug: category.slug } : null,
		tags: item.tags,
		meta: {},
		externalUrl: item.url,
		source: 'fallback'
	};
}
