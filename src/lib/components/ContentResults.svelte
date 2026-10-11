<script lang="ts">
	import NavigationCard from '$lib/components/NavigationCard.svelte';
	import { resolve } from '$app/paths';
	import type { NavigationItem } from '$lib/data/navigation';

	let {
		items,
		emptyMessage = '没有找到符合条件的内容。',
		actionHref = '/',
		actionLabel = '返回首页'
	}: {
		items: NavigationItem[];
		emptyMessage?: string;
		actionHref?: '/' | '/search';
		actionLabel?: string;
	} = $props();
</script>

{#if items.length > 0}
	<div class="cards results-cards">
		{#each items as item (`${item.type}-${item.slug}`)}
			<NavigationCard {item} />
		{/each}
	</div>
{:else}
	<div class="empty-state" role="status">
		<strong>暂无结果</strong>
		<p>{emptyMessage}</p>
		<a class="empty-state-action" href={resolve(actionHref)}>{actionLabel}</a>
	</div>
{/if}
