<script lang="ts">
	import PublicShell from '$lib/components/PublicShell.svelte';
	import ContentResults from '$lib/components/ContentResults.svelte';
	import SearchForm from '$lib/components/SearchForm.svelte';
	import { appConfig } from '$lib/config';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let query = $derived(data.query);
</script>

<svelte:head
	><title>{data.query ? `${data.query}的搜索结果` : '站内搜索'} | {appConfig.displayName}</title
	></svelte:head
>
<PublicShell title={data.title} eyebrow="Search"
	><header class="listing-hero search-listing-hero">
		<div>
			<span>站内检索</span>
			<h1>{data.title}</h1>
			<p>{data.description}</p>
		</div>
		<strong>{data.items.length}<small>条结果</small></strong>
		<SearchForm bind:value={query} />
	</header>
	<ContentResults
		items={data.items}
		emptyMessage={data.query ? '尝试更换关键词。' : '输入关键词开始搜索。'}
		actionHref="/"
		actionLabel="浏览分类"
	/></PublicShell
>
