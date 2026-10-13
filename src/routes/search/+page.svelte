<script lang="ts">
	import PublicShell from '$lib/components/PublicShell.svelte';
	import ContentResults from '$lib/components/ContentResults.svelte';
	import SearchForm from '$lib/components/SearchForm.svelte';
	import { appConfig } from '$lib/config';
	import type { PageProps } from './$types';
	import { resolve } from '$app/paths';
	import { searchPageNumbers, searchPageUrl } from '$lib/search';
	let { data }: PageProps = $props();
	let query = $derived(data.query);
	let category = $derived(data.category);
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
		<strong>{data.total}<small>条结果</small></strong>
		<SearchForm
			bind:value={query}
			bind:category
			categories={data.categories}
			categoryUnavailable={data.categoryUnavailable}
		/>
		<div class="search-filter-context">
			{#if data.categoryUnavailable}<p class="search-filter-error" role="alert">
					当前分类不可用，请重新选择或查看全部分类。
				</p>{/if}
			{#if data.category}<a
					class="search-category-reset"
					href={resolve(searchPageUrl(data.query, 1) as '/search')}>查看全部分类</a
				>{/if}
			<p class="search-category-hint">分类范围包含其可见子分类；修改关键词或分类后点击搜索。</p>
		</div>
	</header>
	<ContentResults
		items={data.items}
		highlightQuery={data.query}
		emptyMessage={data.query ? '尝试更换关键词。' : '输入关键词开始搜索。'}
		actionHref="/"
		actionLabel="浏览分类"
	/>
	{#if data.pageCount > 1}<nav class="search-pagination" aria-label="搜索结果分页">
			<p>第 {data.page} / {data.pageCount} 页</p>
			<div class="search-pagination-links">
				{#if data.page > 1}<a
						href={resolve(searchPageUrl(data.query, data.page - 1, data.category) as '/search')}
						rel="prev">上一页</a
					>{/if}
				{#each searchPageNumbers(data.page, data.pageCount) as number, index (index)}
					{#if number === null}<span class="pagination-gap" aria-hidden="true">…</span>
					{:else}<a
							href={resolve(searchPageUrl(data.query, number, data.category) as '/search')}
							aria-label={`第 ${number} 页`}
							aria-current={number === data.page ? 'page' : undefined}>{number}</a
						>{/if}
				{/each}
				{#if data.page < data.pageCount}<a
						href={resolve(searchPageUrl(data.query, data.page + 1, data.category) as '/search')}
						rel="next">下一页</a
					>{/if}
			</div>
		</nav>{/if}</PublicShell
>
