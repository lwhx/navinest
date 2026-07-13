<script lang="ts">
	import NavigationCard from '$lib/components/NavigationCard.svelte';
	import type { NavigationItem } from '$lib/data/navigation';

	let {
		items,
		emptyMessage = '没有找到符合条件的内容。'
	}: { items: NavigationItem[]; emptyMessage?: string } = $props();
</script>

{#if items.length > 0}
	<div class="cards results-cards">
		{#each items as item (`${item.category}-${item.title}`)}
			<NavigationCard {item} />
		{/each}
	</div>
{:else}
	<div class="empty-state">
		<strong>暂无结果</strong>
		<p>{emptyMessage}</p>
	</div>
{/if}
