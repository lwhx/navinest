<script lang="ts">
	let { name }: { name: string } = $props();
	const paths: Record<string, string> = {
		grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
		document: 'M14 2H5v20h14V7z M14 2v5h5 M8 12h8 M8 16h8',
		folder: 'M3 7V4h6l3 3h9v13H3z',
		tag: 'M3 3h8l10 10-8 8L3 11z M7 7h.01',
		check: 'M9 12l2 2 4-4 M9 3h6v3H9z M9 4H5v17h14V4h-4',
		image: 'M3 3h18v18H3z M3 16l5-5 5 5 3-3 5 5 M16 7h.01',
		layout: 'M3 3h18v18H3z M3 8h18 M9 8v13',
		search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
		trend: 'M3 17l6-6 4 4 8-10 M15 5h6v6',
		settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
		users:
			'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 3a4 4 0 0 1 0 8 M22 21v-3a4 4 0 0 0-3-4',
		message: 'M3 3h18v14H8l-5 4z M7 8h10 M7 12h6',
		spark: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
		clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2',
		archive: 'M3 3h18v4H3z M5 7v14h14V7 M9 11h6',
		external: 'M14 3h7v7 M21 3l-11 11 M10 3H3v18h18v-7',
		menu: 'M3 6h18 M3 12h18 M3 18h18',
		close: 'M6 6l12 12 M6 18L18 6'
	};
</script>

<svg
	class="admin-icon"
	viewBox="0 0 24 24"
	width="20"
	height="20"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"><path d={paths[name] ?? paths.grid} /></svg
>
