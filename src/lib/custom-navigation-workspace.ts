export type NavigationCategory = {
	id: number;
	name: string;
	icon: string | null;
	sortOrder: number;
};
export type NavigationLink = {
	id: number;
	categoryId: number | null;
	title: string;
	url: string;
	summary: string | null;
	sortOrder: number;
	status: 'active' | 'inactive';
};
export type NavigationData = {
	categories: NavigationCategory[];
	links: NavigationLink[];
	version?: string;
};
export type NavigationMutation =
	| { kind: 'link-save'; id: number | null; data: Omit<NavigationLink, 'id'> }
	| { kind: 'category-save'; id: number | null; data: Omit<NavigationCategory, 'id'> }
	| { kind: 'link-delete'; ids: number[] }
	| { kind: 'category-delete'; id: number }
	| {
			kind: 'link-bulk';
			ids: number[];
			change: 'move' | 'active' | 'inactive';
			categoryId?: number | null;
	  }
	| { kind: 'move'; resource: 'link' | 'category'; id: number; direction: -1 | 1 };
export type NavigationPlan = {
	digest: string;
	generatedAt: string;
	title: string;
	detail: string;
	items: { id: number; title: string; url?: string }[];
	affected: number;
};
export type NavigationReceipt = {
	digest: string;
	status: 'completed' | 'cancelled';
	affected: number;
	completedAt: string;
};
export const NAVIGATION_BATCH_LIMIT = 500;
export function navigationFilters(params: URLSearchParams) {
	const integer = (name: string) =>
		/^\d+$/.test(params.get(name) ?? '') ? Number(params.get(name)) : 1;
	return {
		query: (params.get('navQuery') ?? '').slice(0, 200),
		category: /^(all|none|\d+)$/.test(params.get('navCategory') ?? '')
			? params.get('navCategory')!
			: 'all',
		status: ['active', 'inactive'].includes(params.get('navStatus') ?? '')
			? params.get('navStatus')!
			: 'all',
		page: Math.max(1, Math.min(integer('navPage'), 100000)),
		size: params.get('navSize') === '50' ? 50 : 20,
		view: params.get('navView') === 'categories' ? 'categories' : 'links',
		categoryQuery: (params.get('navCategoryQuery') ?? '').slice(0, 80),
		categoryPage: Math.max(1, Math.min(integer('navCategoryPage'), 100000))
	};
}
