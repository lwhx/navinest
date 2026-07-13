<script lang="ts">
	import { resolve } from '$app/paths';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import ContentResults from '$lib/components/ContentResults.svelte';
	import { appConfig } from '$lib/config';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
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
		<form class="public-search-form" action={resolve('/search')} method="GET">
			<input
				name="q"
				value={data.query}
				placeholder="搜索标题、简介或标签"
				aria-label="搜索关键词"
			/><button type="submit">搜索</button>
		</form>
	</header>
	<ContentResults
		items={data.items}
		emptyMessage={data.query ? '尝试更换关键词。' : '输入关键词开始搜索。'}
	/></PublicShell
>
