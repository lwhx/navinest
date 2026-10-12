import {
	categories as fallbackCategories,
	navigationItems as fallbackItems,
	searchEngines as fallbackSearchEngines,
	type NavigationCategory,
	type NavigationItem,
	type SearchEngine as NavigationSearchEngine
} from '$lib/data/navigation';
import type { Database } from '$lib/server/db';
import { listCategories } from '$lib/server/services/categories';
import { loadHomeDashboard } from '$lib/server/services/home-dashboard';
import { buildHomeModulePlan } from '$lib/server/services/home-module-plan';
import { listItems } from '$lib/server/services/items';
import { toNavigationItem } from '$lib/server/services/navigation';
import { listSearchEngines } from '$lib/server/services/search-engines';
import type { Item } from '$lib/types/content';
import { categoryBranch } from '$lib/category-tree';
export type NavigationSection = NavigationCategory & {
	items: NavigationItem[];
	children: NavigationCategory[];
	itemsByChild?: Record<string, NavigationItem[]>;
};
export type HomeData = {
	categories: NavigationCategory[];
	sections: NavigationSection[];
	searchEngines: NavigationSearchEngine[];
	dashboard: Awaited<ReturnType<typeof loadHomeDashboard>>;
	modulePlan: ReturnType<typeof buildHomeModulePlan>;
	source: 'database' | 'fallback';
};
export function buildNavigationSections(
	categories: NavigationCategory[],
	items: Item[]
): NavigationSection[] {
	return categories
		.filter((category) => !category.parentId)
		.map((category) => {
			const children =
				category.id == null
					? []
					: categories.filter((candidate) => candidate.parentId === category.id);
			const branchItems = (root: NavigationCategory) => {
				const branch = categoryBranch(categories, root),
					ids = new Set(branch.flatMap((node) => (node.id == null ? [] : [node.id]))),
					slugs = new Set(branch.map((node) => node.slug));
				return items
					.filter(
						(item) =>
							item.category &&
							(ids.size ? ids.has(item.category.id) : slugs.has(item.category.slug))
					)
					.map(toNavigationItem);
			};
			return {
				...category,
				children,
				items: branchItems(category),
				itemsByChild: Object.fromEntries(children.map((child) => [child.slug, branchItems(child)]))
			};
		});
}
function fallbackSections(): NavigationSection[] {
	return fallbackCategories.map((category) => ({
		...category,
		items: fallbackItems.filter((item) => item.category === category.name),
		children: []
	}));
}
export function fallbackHomeData(): HomeData {
	const sections = fallbackSections(),
		modules: Awaited<ReturnType<typeof loadHomeDashboard>>['modules'] = [
			{ id: 1, type: 'search', title: '聚合搜索', config: {}, sortOrder: 10 },
			{
				id: 2,
				type: 'content',
				title: '常用推荐',
				config: { categorySlug: 'favorites' },
				sortOrder: 20
			},
			{
				id: 3,
				type: 'content',
				title: '开发工具',
				config: { categorySlug: 'dev-tools' },
				sortOrder: 30
			},
			{ id: 4, type: 'ranking', title: '排行榜', config: {}, sortOrder: 100 }
		];
	const dashboard = {
		modules,
		disabledCategorySlugs: [],
		stats: { items: fallbackItems.length, categories: fallbackCategories.length, users: 0 },
		popular: fallbackItems.slice(0, 12).map((item, index) => ({
			id: index + 1,
			type: item.type,
			title: item.title,
			slug: item.slug,
			views: 0,
			favorites: 0,
			score: 0
		})),
		hotnews: []
	};
	return {
		categories: fallbackCategories,
		sections,
		searchEngines: fallbackSearchEngines,
		dashboard,
		modulePlan: buildHomeModulePlan(modules, sections),
		source: 'fallback'
	};
}
export async function loadHomeData(database: Database): Promise<HomeData> {
	const [categories, items, searchEngines, dashboard] = await Promise.all([
		listCategories(database),
		listItems(database),
		listSearchEngines(database),
		loadHomeDashboard(database)
	]);
	const navigationCategories = categories.map((category) => ({
		type: category.type,
		id: category.id,
		parentId: category.parentId,
		name: category.name,
		slug: category.slug,
		icon: category.icon ?? 'link'
	}));
	const sections = buildNavigationSections(navigationCategories, items);
	return {
		categories: navigationCategories,
		sections,
		searchEngines: searchEngines.map((engine) => ({
			name: engine.name,
			key: engine.key,
			urlTemplate: engine.urlTemplate
		})),
		dashboard,
		modulePlan: buildHomeModulePlan(dashboard.modules, sections, dashboard.disabledCategorySlugs),
		source: 'database'
	};
}
