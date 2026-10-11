<script lang="ts">
	import { onMount } from 'svelte';

	let dark = $state(false);

	function applyTheme(isDark: boolean) {
		const theme = isDark ? 'dark' : 'light';
		document.documentElement.dataset.theme = theme;
		document.documentElement.style.colorScheme = theme;
		try {
			localStorage.setItem('navinest-theme', theme);
		} catch {
			/* The current theme remains usable when storage is unavailable. */
		}
	}

	onMount(() => {
		dark = document.documentElement.dataset.theme === 'dark';
	});
</script>

<label class="theme-toggle">
	<span>深色模式</span>
	<input
		type="checkbox"
		bind:checked={dark}
		onchange={() => applyTheme(dark)}
		aria-label="切换深色模式"
	/>
	<i aria-hidden="true"></i>
</label>
