import type { ContentType } from '$lib/types/content';
export type SearchCategory = {
	id: number;
	type: ContentType;
	parentId: number | null;
	name: string;
	slug: string;
};
export type SearchCategoryOption = { value: string; label: string };
const labels: Record<ContentType, string> = {
	site: '网址',
	post: '文章',
	app: '软件资源',
	book: '书籍影视',
	bulletin: '公告'
};
export function searchCategoryKey(category: Pick<SearchCategory, 'type' | 'slug'>) {
	return `${category.type}:${category.slug}`;
}
export function searchCategoryOptions(categories: SearchCategory[]): SearchCategoryOption[] {
	const byId = new Map(categories.map((category) => [category.id, category]));
	return categories.map((category) => {
		const names: string[] = [];
		const seen = new Set<number>();
		let current: SearchCategory | undefined = category;
		while (current && !seen.has(current.id)) {
			seen.add(current.id);
			names.unshift(current.name);
			current = current.parentId === null ? undefined : byId.get(current.parentId);
		}
		return {
			value: searchCategoryKey(category),
			label: `${labels[category.type]} · ${names.join(' / ')}`
		};
	});
}
