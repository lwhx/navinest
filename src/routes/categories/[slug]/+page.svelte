<script lang="ts">
	import { resolve } from '$app/paths';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import ContentResults from '$lib/components/ContentResults.svelte';
	import { appConfig } from '$lib/config';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head
	><title>{data.title} | {appConfig.displayName}</title><meta
		name="description"
		content={data.description}
	/><link
		rel="canonical"
		href={`${appConfig.url}/categories/${encodeURIComponent(data.slug)}`}
	/><meta property="og:title" content={`${data.title} | ${appConfig.displayName}`} /><meta
		property="og:description"
		content={data.description}
	/><meta property="og:type" content="website" /><meta
		property="og:url"
		content={`${appConfig.url}/categories/${encodeURIComponent(data.slug)}`}
	/></svelte:head
>
<PublicShell title={data.title} eyebrow="Category"
	><header class="listing-hero">
		<div>
			<span>分类导航</span>
			<h1>{data.title}</h1>
			<p>{data.description}</p>
		</div>
		<strong>{data.items.length}<small>条内容</small></strong>
	</header>
	{#if data.children.length}
		<nav class="category-child-tabs" aria-label="子分类">
			<a class="active" href={resolve('/categories/[slug]', { slug: data.slug })}>全部</a>
			{#each data.children as child (child.slug)}
				<a href={resolve('/categories/[slug]', { slug: child.slug })}>{child.name}</a>
			{/each}
		</nav>
	{/if}
	<ContentResults items={data.items} emptyMessage="此分类暂时没有内容。" /></PublicShell
>
