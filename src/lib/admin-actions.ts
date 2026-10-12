/** Only overflowing tables need a keyboard stop; arrow keys then scroll the region natively. */
export function scrollableTable(node: HTMLElement) {
	const update = () => {
		if (node.scrollWidth > node.clientWidth + 1) node.tabIndex = 0;
		else node.removeAttribute('tabindex');
	};
	const observer = new ResizeObserver(update);
	observer.observe(node);
	if (node.firstElementChild) observer.observe(node.firstElementChild);
	update();
	return { destroy: () => observer.disconnect() };
}

/** Keep a content editor isolated without changing the public navigation drawer. */
export function adminDialog(node: HTMLElement) {
	const previous = new Map<HTMLElement, boolean>();
	for (
		let branch: HTMLElement | null = node;
		branch?.parentElement;
		branch = branch.parentElement
	) {
		for (const sibling of branch.parentElement.children) {
			if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
			previous.set(sibling, sibling.inert);
			sibling.inert = true;
		}
		if (branch.parentElement === document.body) break;
	}
	const htmlOverflow = document.documentElement.style.overflow;
	const bodyOverflow = document.body.style.overflow;
	document.documentElement.style.overflow = document.body.style.overflow = 'hidden';
	return {
		destroy() {
			for (const [element, inert] of previous) element.inert = inert;
			document.documentElement.style.overflow = htmlOverflow;
			document.body.style.overflow = bodyOverflow;
		}
	};
}
