import {
	categories as fallbackCategories,
	navigationItems as fallbackItems,
	type NavigationItem
} from '$lib/data/navigation';
import type { Database } from '$lib/server/db';
import { listCategories } from '$lib/server/services/categories';
import { listItems } from '$lib/server/services/items';
import { toNavigationItem } from '$lib/server/services/navigation';
import { listTags } from '$lib/server/services/tags';

export type ContentPageData = {
	title: string;
	description: string;
	items: NavigationItem[];
	children: Array<{ name: string; slug: string }>;
	source: 'database' | 'fallback';
};

function includesQuery(item: NavigationItem, query: string): boolean {
	const haystack = [item.title, item.summary, item.category, ...item.tags.map((tag) => tag.name)]
		.join(' ')
		.toLowerCase();
	return haystack.includes(query.toLowerCase());
}

export async function searchContent(database: Database, query: string): Promise<ContentPageData> {
	const items = query ? await listItems(database, { search: query }) : [];
	return {
		title: query ? `“${query}”的搜索结果` : '站内搜索',
		description: query ? `找到 ${items.length} 条相关内容` : '输入关键词搜索站内收藏。',
		items: items.map(toNavigationItem),
		children: [],
		source: 'database'
	};
}

export function searchFallback(query: string): ContentPageData {
	const items = query ? fallbackItems.filter((item) => includesQuery(item, query)) : [];
	return {
		title: query ? `“${query}”的搜索结果` : '站内搜索',
		description: query ? `找到 ${items.length} 条相关内容` : '输入关键词搜索站内收藏。',
		items,
		children: [],
		source: 'fallback'
	};
}

export async function categoryContent(
	database: Database,
	slug: string
): Promise<ContentPageData | null> {
	const categories = await listCategories(database);
	const category = categories.find((entry) => entry.slug === slug);
	if (!category) return null;

	const children = categories.filter((entry) => entry.parentId === category.id);
	const groups = await Promise.all(
		[category, ...children].map((entry) => listItems(database, { categorySlug: entry.slug }))
	);
	const items = groups.flat();
	return {
		title: category.name,
		description: category.description ?? `浏览${category.name}分类下的全部内容。`,
		items: items.map(toNavigationItem),
		children: children.map((entry) => ({ name: entry.name, slug: entry.slug })),
		source: 'database'
	};
}

export function categoryFallback(slug: string): ContentPageData | null {
	const category = fallbackCategories.find((entry) => entry.slug === slug);
	if (!category) return null;

	return {
		title: category.name,
		description: `浏览${category.name}分类下的全部内容。`,
		items: fallbackItems.filter((item) => item.category === category.name),
		children: [],
		source: 'fallback'
	};
}

export async function tagContent(
	database: Database,
	slug: string
): Promise<ContentPageData | null> {
	const tag = (await listTags(database)).find((entry) => entry.slug === slug);
	if (!tag) return null;

	const items = await listItems(database, { tagSlug: slug });
	return {
		title: `标签：${tag.name}`,
		description: tag.description ?? `共 ${items.length} 条带有此标签的内容。`,
		items: items.map(toNavigationItem),
		children: [],
		source: 'database'
	};
}

export function tagFallback(slug: string): ContentPageData | null {
	const tag = fallbackItems.flatMap((item) => item.tags).find((entry) => entry.slug === slug);
	if (!tag) return null;

	const items = fallbackItems.filter((item) => item.tags.some((entry) => entry.slug === slug));
	return {
		title: `标签：${tag.name}`,
		description: `共 ${items.length} 条带有此标签的内容。`,
		items,
		children: [],
		source: 'fallback'
	};
}
