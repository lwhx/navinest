<script lang="ts">
	import { navigating } from '$app/state';
	import { resolve } from '$app/paths';
	import { searchShortcut } from '$lib/ui-actions';
	import { SEARCH_QUERY_LIMIT } from '$lib/search';
	let {
		value = $bindable(''),
		label = '搜索关键词',
		placeholder = '搜索标题、简介或标签',
		variant = 'public',
		onSearch
	}: {
		value?: string;
		label?: string;
		placeholder?: string;
		variant?: 'hero' | 'public';
		onSearch?: () => void;
	} = $props();
	const id = $props.id();
	let input: HTMLInputElement;
	const pending = $derived(Boolean(navigating.to));
</script>

<form
	class:hero-search-form={variant === 'hero'}
	class:public-search-form={variant === 'public'}
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
	<button class="search-submit" type="submit" disabled={!value.trim() || pending}
		>{pending ? '搜索中…' : '搜索'}</button
	>
</form>
<p class="search-hint" id={`${id}-hint`}>按 <kbd>/</kbd> 或 <kbd>Ctrl / ⌘ K</kbd> 快速搜索</p>
