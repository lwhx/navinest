<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { MEDIA_KINDS, mediaFilters, mediaQuery, mediaSize } from '$lib/media-library';
	import type { AdminFileRecord, MediaPage } from '$lib/server/services/admin-files';
	import MediaImage from './MediaImage.svelte';
	let {
		selected = '',
		onselect,
		disabled = false
	}: {
		selected?: string;
		onselect: (file: AdminFileRecord) => void;
		disabled?: boolean;
	} = $props();
	let filters = $state(mediaFilters()),
		result = $state<MediaPage | null>(null),
		loading = $state(false),
		message = $state('');
	let controller: AbortController | undefined;
	let sequence = 0;
	const uid = $props.id();
	async function load(page = 1) {
		controller?.abort();
		controller = new AbortController();
		const current = ++sequence;
		filters.page = page;
		loading = true;
		message = '';
		try {
			const response = await fetch(
				resolve(`/api/admin/files?images=1&${mediaQuery(filters, page)}`),
				{
					signal: controller.signal
				}
			);
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? '图片读取失败。');
			if (current !== sequence) return;
			result = body.page;
			filters = body.page.filters;
		} catch (error) {
			if (current === sequence && !(error instanceof DOMException && error.name === 'AbortError')) {
				result = null;
				message = '图片列表读取失败，当前已选图片保留，请重试。';
			}
		} finally {
			if (current === sequence) loading = false;
		}
	}
	onMount(() => {
		load();
	});
	onDestroy(() => {
		sequence++;
		controller?.abort();
	});
</script>

<div class="media-browser" aria-busy={loading}>
	<div
		class="browser-filters"
		oninput={(event) => event.stopPropagation()}
		onchange={(event) => event.stopPropagation()}
	>
		<label for={`${uid}-q`}
			>搜索图片<input
				id={`${uid}-q`}
				bind:value={filters.q}
				maxlength="120"
				disabled={disabled || loading}
				placeholder="编号、路径或引用名称"
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						load();
					}
				}}
			/></label
		>
		<label for={`${uid}-kind`}
			>图片格式<select id={`${uid}-kind`} bind:value={filters.kind} disabled={disabled || loading}
				>{#each MEDIA_KINDS as [key, label] (key)}<option value={key}>{label}</option
					>{/each}</select
			></label
		>
		<button
			class="admin-secondary-button"
			type="button"
			disabled={disabled || loading}
			onclick={() => load()}>搜索图片</button
		>
	</div>
	{#if message}<p class="field-error" role="alert">{message}</p>
		<button
			class="admin-secondary-button"
			type="button"
			onclick={() => load(filters.page)}
			disabled={disabled || loading}>重试加载图片</button
		>{/if}
	{#if loading}<p role="status">正在读取图片…</p>{/if}
	{#if result}<p class="browser-count">
			共 {result.total} 张 · 第 {result.filters.page} / {result.pageCount} 页
		</p>
		<div class="media-grid">
			{#each result.files as file (file.id)}<button
					type="button"
					aria-label={`选择图片 #${file.id}`}
					aria-pressed={selected === String(file.id)}
					disabled={disabled || loading}
					onclick={() => onselect(file)}
					><MediaImage id={file.id} /><strong>图片 #{file.id}</strong><small
						>{mediaSize(file.size)}</small
					></button
				>{:else}<p>没有匹配的图片，可更改搜索条件或上传图片。</p>{/each}
		</div>
		<div class="browser-pages">
			<button
				type="button"
				class="admin-secondary-button"
				disabled={disabled || loading || result.filters.page <= 1}
				onclick={() => load(result!.filters.page - 1)}>上一页图片</button
			><button
				type="button"
				class="admin-secondary-button"
				disabled={disabled || loading || result.filters.page >= result.pageCount}
				onclick={() => load(result!.filters.page + 1)}>下一页图片</button
			>
		</div>
	{/if}
</div>

<style>
	.media-browser {
		min-width: 0;
		display: grid;
		gap: 12px;
		margin-top: 12px;
	}
	.browser-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: end;
	}
	label {
		display: grid;
		gap: 6px;
		flex: 1 1 150px;
		min-width: 0;
		color: var(--admin-text);
		font-size: 13px;
	}
	input,
	select {
		width: 100%;
		min-width: 0;
		min-height: 44px;
	}
	.media-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 10px;
		max-height: 380px;
		overflow: auto;
	}
	.media-grid button {
		display: grid;
		gap: 6px;
		min-width: 0;
		padding: 8px;
		border: 1px solid var(--admin-border);
		border-radius: 10px;
		color: var(--admin-text);
		background: var(--admin-surface);
		text-align: left;
		cursor: pointer;
	}
	.media-grid button[aria-pressed='true'] {
		border-color: var(--admin-accent);
	}
	.media-grid :global(.media-image) {
		height: 90px;
	}
	small,
	.browser-count {
		color: var(--admin-muted);
		font-size: 13px;
	}
	.browser-count {
		margin: 0;
	}
	.browser-pages {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
</style>
