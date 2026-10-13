type SubcategorySection = { slug: string; children: { slug: string }[] };
const prefix = 'sub.';

export function readHomeSubcategories(url: URL, sections: SubcategorySection[]) {
	const selected: Record<string, string> = Object.create(null);
	for (const section of sections) {
		const values = url.searchParams.getAll(prefix + section.slug);
		if (values.length === 1 && section.children.some((child) => child.slug === values[0]))
			selected[section.slug] = values[0];
	}
	return selected;
}

export function homeSubcategoryUrl(url: URL, sectionSlug: string, childSlug: string | null) {
	const target = new URL(url);
	if (childSlug === null) target.searchParams.delete(prefix + sectionSlug);
	else target.searchParams.set(prefix + sectionSlug, childSlug);
	target.hash = sectionSlug;
	// The homepage resolves its own route/base path; this suffix only carries selection state.
	return target.search + target.hash;
}
