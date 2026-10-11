type Module = {
	id: number;
	type: string;
	title: string;
	sortOrder: number;
	config: Record<string, unknown>;
};
type Section = { slug: string; name: string };
type Link = { label: string; url: string };
export type HomePlanItem = {
	key: string;
	type: 'search' | 'content' | 'ranking' | 'hot' | 'links';
	title: string;
	categorySlug?: string;
	links?: Link[];
};
function safeUrl(value: unknown) {
	if (typeof value !== 'string') return null;
	if (value.startsWith('/') && !value.startsWith('//')) return value;
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}
function links(config: Record<string, unknown>) {
	if (!Array.isArray(config.links)) return [];
	return config.links
		.flatMap((value) => {
			if (!value || typeof value !== 'object') return [];
			const row = value as Record<string, unknown>,
				url = safeUrl(row.url),
				label = typeof row.label === 'string' ? row.label.trim() : '';
			return url && label ? [{ label: label.slice(0, 80), url }] : [];
		})
		.slice(0, 12);
}
export function buildHomeModulePlan(
	modules: Module[],
	sections: Section[],
	disabledCategorySlugs: string[] = []
): HomePlanItem[] {
	const known = new Set(sections.map((x) => x.slug)),
		used = new Set<string>(),
		auxiliary = new Set<string>(),
		plan: HomePlanItem[] = [];
	for (const module of [...modules].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)) {
		if (module.type === 'content') {
			const slug = typeof module.config.categorySlug === 'string' ? module.config.categorySlug : '';
			if (!known.has(slug) || used.has(slug)) continue;
			used.add(slug);
			plan.push({
				key: `content:${slug}`,
				type: 'content',
				title: module.title,
				categorySlug: slug
			});
		} else if (module.type === 'search' || module.type === 'ranking' || module.type === 'hot') {
			// Ranking/hot modules currently share one dataset; retain the first enabled entry.
			if (module.type !== 'search') {
				if (auxiliary.has(module.type)) continue;
				auxiliary.add(module.type);
			}
			plan.push({ key: `${module.type}:${module.id}`, type: module.type, title: module.title });
		} else if (module.type === 'links') {
			const safe = links(module.config);
			if (safe.length)
				plan.push({ key: `links:${module.id}`, type: 'links', title: module.title, links: safe });
		}
	}
	const extraCategories: HomePlanItem[] = sections
		.filter((section) => !used.has(section.slug) && !disabledCategorySlugs.includes(section.slug))
		.map((section) => ({
			key: `content:${section.slug}`,
			type: 'content',
			title: section.name,
			categorySlug: section.slug
		}));
	// Keep saved modules in their relative order; fill categories before trailing auxiliary lists.
	let insertion = plan.length;
	while (insertion > 0 && ['ranking', 'hot'].includes(plan[insertion - 1].type)) insertion--;
	plan.splice(insertion, 0, ...extraCategories);
	return plan;
}
