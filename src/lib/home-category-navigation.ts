type CategoryModule = { type: string; title: string; categorySlug?: string };

export function buildHomeCategoryLinks(modules: CategoryModule[], sections: { slug: string }[]) {
	const rendered = new Set(sections.map((section) => section.slug));
	return modules.flatMap((module) =>
		module.type === 'content' && module.categorySlug && rendered.has(module.categorySlug)
			? [{ slug: module.categorySlug, name: module.title }]
			: []
	);
}

export function activeHomeCategory(sections: { id: string; top: number }[], offset: number) {
	let active = sections[0]?.id ?? '';
	for (const section of sections) {
		if (section.top > offset + 1) break;
		active = section.id;
	}
	return active;
}

export function trackHomeCategories(onActive: (slug: string) => void) {
	const sections = [...document.querySelectorAll<HTMLElement>('[data-category-section]')];
	const spacer = document.querySelector<HTMLElement>('.home-anchor-spacer');
	if (!sections.length || !spacer) return;
	const offset = () => parseFloat(getComputedStyle(sections[0]).scrollMarginTop) || 104;
	let frame = 0;
	function updateActive() {
		frame = 0;
		onActive(
			activeHomeCategory(
				sections.map((section) => ({ id: section.id, top: section.getBoundingClientRect().top })),
				offset()
			)
		);
	}
	function scheduleActive() {
		if (!frame) frame = requestAnimationFrame(updateActive);
	}
	function updateSpace() {
		// Add only the missing scroll space so even the final heading can reach the anchor line.
		const lastTop = sections.at(-1)!.getBoundingClientRect().top + window.scrollY;
		const naturalHeight =
			document.documentElement.scrollHeight - spacer!.getBoundingClientRect().height;
		const height = Math.ceil(Math.max(0, lastTop - offset() + window.innerHeight - naturalHeight));
		spacer!.style.height = `${height}px`;
		scheduleActive();
	}
	updateSpace();
	// A direct fragment URL may have been clamped before the client added the required space.
	const initialTarget = sections.find((section) => `#${section.id}` === window.location.hash);
	initialTarget?.scrollIntoView({ block: 'start' });
	const observer = new ResizeObserver(updateSpace);
	for (const selector of ['.home-content-layout', '.home-footer', '.home-header']) {
		const element = document.querySelector(selector);
		if (element) observer.observe(element);
	}
	window.addEventListener('scroll', scheduleActive, { passive: true });
	window.addEventListener('resize', updateSpace);
	return () => {
		observer.disconnect();
		window.removeEventListener('scroll', scheduleActive);
		window.removeEventListener('resize', updateSpace);
		cancelAnimationFrame(frame);
	};
}
