/** Focus the existing search field without interrupting typing or an open dialog. */
export function searchShortcut(node: HTMLInputElement) {
	function keydown(event: KeyboardEvent) {
		if (event.defaultPrevented || event.isComposing || event.altKey) return;
		const slash = event.key === '/' && !event.ctrlKey && !event.metaKey;
		const command = event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey);
		if (!slash && !command) return;
		const target = event.target;
		if (
			(target instanceof Element &&
				target.closest(
					'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'
				)) ||
			document.querySelector('[aria-modal="true"]')
		)
			return;
		event.preventDefault();
		node.focus();
	}
	window.addEventListener('keydown', keydown);
	return { destroy: () => window.removeEventListener('keydown', keydown) };
}

/** Keep keyboard focus inside a drawer and restore the trigger when it closes. */
export function modalDrawer(node: HTMLElement, onClose: () => void) {
	const trigger = document.activeElement;
	const previous = new Map<HTMLElement, boolean>();
	for (
		let branch: HTMLElement | null = node;
		branch?.parentElement;
		branch = branch.parentElement
	) {
		for (const sibling of branch.parentElement.children) {
			if (
				sibling === branch ||
				!(sibling instanceof HTMLElement) ||
				sibling.matches('[data-drawer-backdrop]')
			)
				continue;
			previous.set(sibling, sibling.inert);
			sibling.inert = true;
		}
		if (branch.parentElement === document.body) break;
	}
	const controls = () =>
		[
			...node.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]'
			)
		].filter((control) => control.getClientRects().length > 0);
	controls()[0]?.focus();
	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onClose();
		} else if (event.key === 'Tab') {
			const items = controls(),
				first = items[0],
				last = items.at(-1);
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
		}
	}
	node.addEventListener('keydown', keydown);
	const viewport = matchMedia('(max-width: 900px)');
	const resized = () => {
		if (!viewport.matches) onClose();
	};
	viewport.addEventListener('change', resized);
	return {
		destroy() {
			node.removeEventListener('keydown', keydown);
			viewport.removeEventListener('change', resized);
			for (const [element, inert] of previous) element.inert = inert;
			if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
		}
	};
}
