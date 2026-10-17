<script lang="ts">
	import { onMount } from 'svelte';
	import { navigating } from '$app/state';
	import { resolve } from '$app/paths';
	import { searchShortcut } from '$lib/ui-actions';
	import type { SearchCategoryOption } from '$lib/search-categories';
	import { SEARCH_QUERY_LIMIT } from '$lib/search';
	let {
		value = $bindable(''),
		label = '搜索关键词',
		placeholder = '搜索标题、简介或标签',
		variant = 'public',
		onSearch,
		category = $bindable(''),
		categories = [],
		categoryUnavailable = false
	}: {
		value?: string;
		label?: string;
		placeholder?: string;
		variant?: 'hero' | 'public';
		onSearch?: () => void;
		category?: string;
		categories?: SearchCategoryOption[];
		categoryUnavailable?: boolean;
	} = $props();
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	const id = $props.id();
	let input: HTMLInputElement;
	const pending = $derived(Boolean(navigating.to));
</script>

<form
	class:hero-search-form={variant === 'hero'}
	class:public-search-form={variant === 'public'}
	class:search-filter-form={categories.length > 0 || categoryUnavailable}
	action={resolve('/search')}
	method="GET"
	role="search"
	aria-label={variant === 'hero' ? '聚合搜索' : '站内搜索'}
	aria-busy={pending}
	onsubmit={(event) => {
		if (!value.trim() || pending) event.preventDefault();
		else if (onSearch) {
			event.preventDefault();
			onSearch();
		}
	}}
>
	{#snippet controls()}
		<span class="search-symbol" aria-hidden="true">⌕</span>
		<input
			bind:this={input}
			bind:value
			type="search"
			maxlength={SEARCH_QUERY_LIMIT}
			name="q"
			aria-label={label}
			aria-describedby={`${id}-hint`}
			{placeholder}
			use:searchShortcut
		/>
		{#if value}<button
				class="search-clear"
				type="button"
				aria-label="清空搜索"
				onclick={() => {
					value = '';
					input.focus();
				}}>×</button
			>{/if}
		<button class="search-submit" type="submit" disabled={pending || (mounted && !value.trim())}
			>{pending ? '搜索中…' : '搜索'}</button
		>
	{/snippet}
	{#if categories.length > 0 || categoryUnavailable}
		<div class="search-query-row">{@render controls()}</div>
		<label class="search-category-field" for={`${id}-category`}
			><span>分类范围</span><select id={`${id}-category`} name="category" bind:value={category}>
				<option value="">全部分类</option>
				{#if categoryUnavailable}<option value={category}>当前分类不可用</option>{/if}
				{#each categories as option (option.value)}<option value={option.value}
						>{option.label}</option
					>{/each}
			</select></label
		>
	{:else}{@render controls()}{/if}
</form>
<p class="search-hint" id={`${id}-hint`}>按 <kbd>/</kbd> 或 <kbd>Ctrl / ⌘ K</kbd> 快速搜索</p>
