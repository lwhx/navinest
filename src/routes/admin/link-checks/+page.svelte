<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { beforeNavigate } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		LINK_CHECK_BATCH_SIZE,
		linkCheckLabels,
		linkCheckReasons,
		linkCheckUrl
	} from '$lib/link-checks';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let busy = $state(false),
		notice = $state('');
	const selected = new SvelteSet<number>();
	const params = $derived(
		new URLSearchParams({ q: data.filters.q, result: data.filters.result, page: String(data.page) })
	);
	const listUrl = $derived(linkCheckUrl(params));
	const actionUrl = $derived(listUrl + (listUrl.includes('?') ? '&' : '?') + '/check');
	$effect(() => {
		void data.items;
		selected.clear();
	});
	beforeNavigate(({ cancel }) => {
		if (busy) cancel();
	});
	const submit: SubmitFunction = ({ cancel }) => {
		if (busy || !selected.size || selected.size > LINK_CHECK_BATCH_SIZE) {
			if (!busy) notice = `请先选择 1–${LINK_CHECK_BATCH_SIZE} 个网址。`;
			cancel();
			return;
		}
		busy = true;
		notice = '';
		return async ({ result, update }) => {
			try {
				if (result.type === 'error') notice = '检查结果待核对，请刷新列表确认后再重试。';
				else {
					await update({ reset: false });
					if (result.type === 'success') selected.clear();
				}
			} catch {
				notice = '检查结果待核对，请刷新列表确认后再重试。';
			} finally {
				busy = false;
			}
		};
	};
	function checkedAt(value: string | undefined) {
		return value && Number.isFinite(Date.parse(value))
			? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
			: '—';
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">LINK CHECKS</p>
		<h1>网址检查</h1>
		<p class="admin-page-description">检查已收录的网站网址，再决定是否修正。包括草稿和私有内容。</p>
	</div>
	<a
		class="admin-secondary-button"
		href={resolve('/admin/items')}
		aria-disabled={busy}
		onclick={(event) => {
			if (busy) event.preventDefault();
		}}>返回内容管理</a
	>
</header>
<p class="admin-notice">
	每次最多检查 {LINK_CHECK_BATCH_SIZE} 个网址。403、超时等仅标为“待核实”；404 / 410 单独列出。跳转地址仅供参考，需通过编辑修改。检查结果是当时的响应，不保证页面内容可用。
</p>
{#if notice || form?.message}<p role="status" class="admin-form-message">
		{notice || form?.message}
	</p>{/if}
<form method="GET" action={resolve('/admin/link-checks')} class="check-filters">
	<fieldset disabled={busy}>
		<label
			>搜索标题或网址<input
				name="q"
				value={data.filters.q}
				maxlength="160"
				placeholder="搜索已收录的网址"
			/></label
		>
		<label
			>检查结果<select name="result" value={data.filters.result}
				><option value="all">全部结果</option
				>{#each Object.entries(linkCheckLabels) as [value, label] (value)}<option {value}
						>{label}</option
					>{/each}</select
			></label
		>
		<button class="admin-secondary-button" type="submit">筛选</button>
	</fieldset>
</form>
<form
	method="POST"
	action={resolve(actionUrl as '/admin/link-checks')}
	use:enhance={submit}
	aria-busy={busy}
>
	<div class="check-toolbar">
		<p>共 {data.total} 项 · 第 {data.page} / {data.pageCount} 页</p>
		<button class="admin-primary-button" type="submit" disabled={busy}
			>{busy ? '正在检查，请稍候…' : '检查所选网址'}</button
		>
	</div>
	<p class="check-selection" aria-live="polite">
		已选 {selected.size} / {LINK_CHECK_BATCH_SIZE} 项 · 选择仅保留在当前页
	</p>
	{#if !data.items.length}<div class="check-empty">
			没有符合条件的网址。可调整筛选条件后重试。
		</div>{/if}
	<div class="check-list">
		{#each data.items as item (item.id)}
			<article class="check-row" data-check-id={item.id}>
				<label class="check-select"
					><input
						type="checkbox"
						name="ids"
						value={item.id}
						checked={selected.has(item.id)}
						disabled={busy || (!selected.has(item.id) && selected.size >= LINK_CHECK_BATCH_SIZE)}
						onchange={(event) => {
							if (event.currentTarget.checked) selected.add(item.id);
							else selected.delete(item.id);
						}}
						aria-label={'选择 ' + item.title}
					/><span class="sr-only">{item.title}</span></label
				>
				<div class="check-content">
					<div class="check-title">
						<h2>{item.title}</h2>
						<span class:check-gone={item.status === 'gone'} class="check-badge"
							>{linkCheckLabels[item.status]}</span
						>
					</div>
					<p class="check-url">{item.url || '尚未填写网址'}</p>
					<p class="check-meta">
						{item.category ?? '未分类'} · {item.publication === 'draft' ? '草稿' : '已发布'} · {item.visibility ===
						'private'
							? '私有'
							: '公开'}
					</p>
					{#if item.result && item.status !== 'unchecked'}
						<p class="check-detail">
							{item.result.httpStatus ? `HTTP ${item.result.httpStatus} · ` : ''}{checkedAt(
								item.result.checkedAt
							)}（北京时间）{item.status === 'stale' ? ' · 以下为旧网址的检查记录' : ''}
						</p>
						<p class="check-detail">
							{linkCheckReasons[item.result.reason] ?? '请人工核实此网址。'}
						</p>
						{#if item.status === 'stale'}<p class="check-url">检查时网址：{item.result.url}</p>{/if}
						{#if item.result.finalUrl && item.result.finalUrl !== item.result.url}<p
								class="check-url"
							>
								最后访问地址：{item.result.finalUrl}
							</p>{/if}
					{/if}
				</div>
				<a
					class="admin-secondary-button check-edit"
					target="_blank"
					rel="noopener"
					href={resolve(`/admin/items?type=site&edit=${item.id}` as '/admin/items')}
					aria-disabled={busy}
					onclick={(event) => {
						if (busy) event.preventDefault();
					}}>编辑<span class="sr-only"> {item.title}（新标签页）</span></a
				>
			</article>
		{/each}
	</div>
</form>
<nav class="check-pagination" aria-label="网址检查分页">
	{#if data.page > 1}<a
			class="admin-secondary-button"
			href={resolve(linkCheckUrl(params, data.page - 1) as '/admin/link-checks')}>上一页</a
		>{/if}
	{#if data.page < data.pageCount}<a
			class="admin-secondary-button"
			href={resolve(linkCheckUrl(params, data.page + 1) as '/admin/link-checks')}>下一页</a
		>{/if}
</nav>

<style>
	.check-filters {
		margin: 1.25rem 0;
	}
	fieldset {
		display: flex;
		gap: 0.75rem;
		align-items: end;
		border: 0;
		padding: 0;
		margin: 0;
		flex-wrap: wrap;
	}
	label {
		display: grid;
		gap: 0.4rem;
		font-size: 0.85rem;
	}
	input:not([type='checkbox']),
	select {
		min-height: 44px;
		padding: 0.65rem 0.8rem;
		border: 1px solid var(--admin-border);
		border-radius: 0.6rem;
		background: var(--admin-surface);
		color: var(--admin-text);
		min-width: 0;
		max-width: 100%;
	}
	.check-toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.check-toolbar p,
	.check-selection,
	.check-meta,
	.check-detail {
		color: var(--admin-muted);
		font-size: 0.82rem;
	}
	.check-selection {
		margin: 0.65rem 0;
	}
	.check-list {
		display: grid;
		gap: 0.6rem;
	}
	.check-row {
		display: flex;
		align-items: start;
		gap: 0.8rem;
		padding: 1rem;
		border: 1px solid var(--admin-border);
		border-radius: 0.8rem;
		background: var(--admin-surface);
		min-width: 0;
	}
	.check-select {
		padding: 0.35rem 0;
		flex: none;
		min-width: 44px;
		min-height: 44px;
		place-items: center;
	}
	.check-select input {
		width: 20px;
		height: 20px;
	}
	.check-content {
		min-width: 0;
		flex: 1;
	}
	.check-title {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	h2 {
		font-size: 0.95rem;
		margin: 0;
		overflow-wrap: anywhere;
	}
	.check-badge {
		font-size: 0.72rem;
		background: var(--admin-soft);
		border: 1px solid var(--admin-border);
		border-radius: 99px;
		padding: 0.2rem 0.6rem;
	}
	.check-gone {
		color: var(--admin-danger);
		background: var(--admin-accent-soft);
	}
	.check-url {
		font-size: 0.8rem;
		margin: 0.45rem 0;
		overflow-wrap: anywhere;
		word-break: break-word;
	}
	.check-meta,
	.check-detail {
		margin: 0.35rem 0;
		overflow-wrap: anywhere;
	}
	.check-edit {
		flex: none;
		font-size: 0.8rem;
		min-height: 44px;
	}
	.check-empty {
		padding: 2rem;
		text-align: center;
		border: 1px dashed var(--admin-border);
		border-radius: 0.8rem;
		color: var(--admin-muted);
	}
	.check-pagination {
		display: flex;
		justify-content: flex-end;
		gap: 0.7rem;
		margin: 1rem 0;
	}
	@media (max-width: 600px) {
		.check-row {
			padding: 0.8rem;
			gap: 0.6rem;
			flex-wrap: wrap;
		}
		.check-edit {
			margin-left: 1.5rem;
		}
		fieldset label {
			flex: 1 1 100%;
		}
		.check-filters input,
		.check-filters select {
			width: 100%;
		}
	}
</style>
