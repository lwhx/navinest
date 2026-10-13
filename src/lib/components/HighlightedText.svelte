<script lang="ts">
	import { searchTextParts } from '$lib/search';
	let { text, query = '' }: { text: string; query?: string } = $props();
	let parts = $derived(searchTextParts(text, query));
</script>

{#each parts as part, index (index)}{#if part.match}<mark class="search-match">{part.text}</mark
		>{:else}{part.text}{/if}{/each}

<style>
	mark {
		color: var(--ui-accent);
		background: var(--ui-accent-soft);
		border-radius: 2px;
		padding: 0;
		font: inherit;
	}
</style>
