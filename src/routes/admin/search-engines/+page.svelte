<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { beforeNavigate } from '$app/navigation';
	import { tick, onMount } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		searchSourcePreview,
		searchSourceListUrl,
		INTERNAL_SEARCH_TEMPLATE
	} from '$lib/search-source';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	function initialDraft() {
		const current = data.editing,
			values = (form && 'values' in form ? form.values : null) as Record<string, unknown> | null;
		const field = (key: string, fallback = '') =>
			typeof values?.[key] === 'string' ? (values[key] as string) : fallback;
		return {
			name: field('name', current?.name),
			groupKey: field('groupKey', current?.groupKey ?? 'general'),
			key: field('key', current?.key),
			urlTemplate: field('urlTemplate', current?.urlTemplate),
			placeholder: field('placeholder', current?.placeholder ?? ''),
			sortOrder: field('sortOrder', String(current?.sortOrder ?? 0)),
			isEnabled: values ? values.isEnabled === 'on' : current?.isEnabled !== false,
			sampleQuery: field('sampleQuery', '中文 & C++ / #?')
		};
	}
	let draft = $derived(initialDraft());

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	let busy = $state(false),
		notice = $state(''),
		localPreview = $state<ReturnType<typeof searchSourcePreview> | null>(null),
		previewInvalid = $state(false),
		heading = $state<HTMLHeadingElement | null>(null);
	const errors = $derived((form && 'errors' in form ? form.errors : {}) as Record<string, string>);
	const preview = $derived(
		previewInvalid ? null : (localPreview ?? (form && 'preview' in form ? form.preview : null))
	);
	const params = $derived(new URLSearchParams(data.filters));
	const createUrl = $derived(data.listUrl + (data.listUrl.includes('?') ? '&' : '?') + 'create=1');
	const editorAction = $derived(
		(name: string) =>
			data.listUrl +
			(data.listUrl.includes('?') ? '&' : '?') +
			(data.mode === 'create' ? 'create=1' : `edit=${data.editing?.id}`) +
			`&/${name}`
	);
	beforeNavigate(({ cancel }) => {
		if (busy) cancel();
	});
	function invalidate(event: Event) {
		if (['urlTemplate', 'sampleQuery'].includes((event.target as HTMLInputElement).name)) {
			localPreview = null;
			previewInvalid = true;
		}
	}
	async function inspect() {
		localPreview = searchSourcePreview(draft.urlTemplate, draft.sampleQuery);
		previewInvalid = false;
		await tick();
		heading?.focus();
	}
	const submit: SubmitFunction = ({ cancel }) => {
		if (busy) {
			cancel();
			return;
		}
		busy = true;
		notice = '';
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'error') {
				notice = '保存结果待核对，填写内容已保留。请查看列表确认后再重试。';
				return;
			}
			await update({ reset: false });
			if (result.type === 'failure') {
				await tick();
				document.querySelector<HTMLElement>('.source-editor [aria-invalid=true]')?.focus();
			}
		};
	};
	const moveUrl = $derived(data.listUrl + (data.listUrl.includes('?') ? '&' : '?') + '/move');
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">SEARCH SOURCES</p>
		<h1>搜索源管理</h1>
		<p class="admin-page-description">维护首页的搜索入口，先预览链接，再保存和调整顺序。</p>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve(createUrl as '/admin/search-engines')}>新增搜索源</a
		>{/if}
</header>
{#if data.source === 'fallback'}<p class="admin-notice">当前为只读示例。</p>{/if}
{#if notice}<p role="status" class="admin-form-message">
		{notice}
		<a href={resolve(data.listUrl as '/admin/search-engines')} target="_blank" rel="noopener"
			>打开列表核对</a
		>
	</p>{/if}
{#if form?.message}<p class="admin-form-message" role="status">{form.message}</p>{/if}
<section class="source-summary" aria-label="搜索源概览">
	<div><span>全部搜索源</span><strong>{data.counts.total}</strong></div>
	<div><span>已启用</span><strong>{data.counts.enabled}</strong></div>
	<div><span>模板需修正</span><strong>{data.counts.invalid}</strong></div>
	<div>
		<span>首次访问默认</span><strong class="default-name"
			>{data.defaultEngine?.name ?? '站内搜索兜底'}</strong
		>
	</div>
</section>
<p class="source-note">
	首页按排序展示有效的启用源，首次访问默认使用最前一项；用户已记住的选择优先。分组用于后台整理。全部停用或模板不可用时，仍可使用站内搜索。
</p>

{#if data.mode && data.source === 'database'}<section
		class="admin-editor source-editor"
		aria-labelledby="source-editor-title"
	>
		<div class="admin-editor-header">
			<div>
				<p class="eyebrow">CONFIGURE & PREVIEW</p>
				<h2 id="source-editor-title">
					{data.mode === 'create' ? '新增搜索源' : `编辑：${data.editing?.name ?? '记录不可用'}`}
				</h2>
			</div>
			<a href={resolve(data.listUrl as '/admin/search-engines')} aria-label="关闭搜索源编辑器">×</a>
		</div>
		{#if data.mode === 'create' || data.editing}
			<form
				class="admin-form"
				method="POST"
				action={editorAction(data.mode === 'create' ? 'create' : 'update')}
				use:enhance={submit}
				oninput={invalidate}
				onchange={invalidate}
			>
				<input type="hidden" name="returnTo" value={data.listUrl} />{#if data.editing}<input
						type="hidden"
						name="id"
						value={data.editing.id}
					/>{/if}
				<fieldset class="admin-form-section" disabled={busy}>
					<legend>名称与展示</legend>
					<div class="admin-form-grid">
						<label
							><span>搜索源名称</span><input
								name="name"
								maxlength="80"
								required
								bind:value={draft.name}
								aria-invalid={Boolean(errors.name)}
							/>{#if errors.name}<small class="field-error">{errors.name}</small>{/if}</label
						>
						<label
							><span>分组</span><input
								name="groupKey"
								list="source-groups"
								maxlength="80"
								required
								bind:value={draft.groupKey}
								aria-invalid={Boolean(errors.groupKey)}
							/><datalist id="source-groups"
								>{#each [...new Set( [...data.groups, 'onsite', 'general', 'dev'] )] as group (group)}<option
										value={group}
									></option>{/each}</datalist
							><small>选择已有分组，也可输入新的分组名称。</small>{#if errors.groupKey}<small
									class="field-error">{errors.groupKey}</small
								>{/if}</label
						>
						<label
							><span>唯一标识</span><input
								name="key"
								required
								maxlength="80"
								pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
								bind:value={draft.key}
								aria-invalid={Boolean(errors.key)}
							/><small>小写字母、数字和连字符。用于记住选择，修改后旧选择会回到默认源。</small
							>{#if errors.key}<small class="field-error">{errors.key}</small>{/if}</label
						>
						<label
							><span>搜索框提示文字</span><input
								name="placeholder"
								maxlength="160"
								placeholder="例如：搜索项目、代码与开发资料"
								bind:value={draft.placeholder}
							/><small>首页选中此源时显示，留空使用默认提示。</small></label
						>
					</div>
				</fieldset>
				<fieldset class="admin-form-section" disabled={busy}>
					<legend>链接模板与预览</legend>
					<div class="admin-form-grid">
						<label class="admin-field-wide"
							><span>搜索链接模板</span><input
								name="urlTemplate"
								required
								maxlength="2000"
								placeholder={'https://example.com/search?q={query}'}
								bind:value={draft.urlTemplate}
								aria-invalid={Boolean(errors.urlTemplate)}
							/><small
								>用一个 {'{query}'} 表示搜索词，系统会自动编码中文、空格及特殊符号。仅支持站内搜索或公网
								HTTP/HTTPS 地址。</small
							>{#if errors.urlTemplate}<small class="field-error">{errors.urlTemplate}</small
								>{/if}</label
						>
						<label
							><span>示例搜索词</span><input
								name="sampleQuery"
								maxlength="200"
								bind:value={draft.sampleQuery}
							/><small>仅用于预览，不会保存为用户的搜索词。</small></label
						>
					</div>
					<div class="source-preview-actions">
						<button
							class="admin-secondary-button"
							type="submit"
							formaction={editorAction('preview')}
							formnovalidate
							onclick={(event) => {
								event.preventDefault();
								void inspect();
							}}>预览搜索链接</button
						>{#if mounted}<button
								class="admin-secondary-button"
								type="button"
								onclick={() => {
									draft = { ...draft, urlTemplate: INTERNAL_SEARCH_TEMPLATE };
									previewInvalid = true;
								}}>填入站内模板</button
							>{:else}<small>站内模板：{INTERNAL_SEARCH_TEMPLATE}</small>{/if}
					</div>
					{#if preview}<section class="source-preview" aria-label="搜索链接预览">
							<h3 tabindex="-1" bind:this={heading}>搜索链接预览</h3>
							{#if preview.valid}<p>
									目标：<strong>{preview.host}</strong> · 搜索词：{preview.keyword}
								</p>
								<code>{preview.target}</code>
								<p class="source-note">
									链接生成正确不代表目标网站一定可访问。预览没有保存配置，也没有请求目标网站。
								</p>
								<a
									class="admin-secondary-button"
									href={resolve(
										(preview.internal
											? preview.target
											: `/go?url=${encodeURIComponent(preview.target)}`) as '/search'
									)}
									target="_blank"
									rel="noopener noreferrer">新标签试搜</a
								>{:else}<p class="field-error" role="alert">{preview.error}</p>{/if}
						</section>{/if}
				</fieldset>
				<fieldset class="admin-form-section" disabled={busy}>
					<legend>顺序与状态</legend>
					<div class="admin-form-grid">
						<label
							><span>排序值</span><input
								type="number"
								name="sortOrder"
								min="-100000"
								max="100000"
								bind:value={draft.sortOrder}
								aria-invalid={Boolean(errors.sortOrder)}
							/><small>值越小越靠前；相同值按名称、编号稳定排列。</small
							>{#if errors.sortOrder}<small class="field-error">{errors.sortOrder}</small
								>{/if}</label
						>
					</div>
					<label class="admin-checkbox"
						><input name="isEnabled" type="checkbox" bind:checked={draft.isEnabled} /><span
							>启用并在首页展示</span
						></label
					>
				</fieldset>
				<div class="admin-form-actions">
					<button class="admin-primary-button" type="submit" disabled={busy}
						>{busy ? '保存中…' : '保存搜索源'}</button
					><a class="admin-secondary-button" href={resolve(data.listUrl as '/admin/search-engines')}
						>取消</a
					>
				</div>
			</form>{:else}<p class="admin-notice">此搜索源已被移除，请返回列表核对。</p>{/if}
	</section>{/if}

<section class="admin-panel source-list" aria-labelledby="source-list-title">
	<div class="admin-panel-heading">
		<h2 id="source-list-title">搜索源列表</h2>
		<span>共 {data.total} 条 · 第 {data.page} / {data.pages} 页</span>
	</div>
	<form method="GET" class="source-filters">
		<label
			>搜索<input
				type="search"
				name="q"
				maxlength="200"
				value={data.filters.q}
				placeholder="名称、标识或地址"
			/></label
		><label
			>分组筛选<select name="group"
				><option value="">全部分组</option
				>{#if data.filters.group && !data.groups.includes(data.filters.group)}<option
						value={data.filters.group}
						selected>{data.filters.group}（暂无记录）</option
					>{/if}{#each data.groups as group (group)}<option
						value={group}
						selected={data.filters.group === group}>{group}</option
					>{/each}</select
			></label
		><label
			>状态筛选<select name="status"
				><option value="">全部状态</option><option
					value="enabled"
					selected={data.filters.status === 'enabled'}>已启用</option
				><option value="disabled" selected={data.filters.status === 'disabled'}>已停用</option
				><option value="invalid" selected={data.filters.status === 'invalid'}>模板需修正</option
				></select
			></label
		><button class="admin-secondary-button" type="submit" disabled={busy}>筛选</button><a
			class="admin-secondary-button"
			href={resolve('/admin/search-engines')}>重置</a
		>
	</form>
	{#if data.mode}<p class="source-note">
			编辑期间列表操作暂停，保存或关闭编辑器后可调整排序和状态。
		</p>{/if}
	<div class="source-cards">
		{#each data.searchEngines as engine (engine.id)}<article
				class="source-card"
				aria-label={engine.name}
			>
				<header>
					<div>
						<small>全站第 {engine.position} 位 · 排序 {engine.sortOrder}</small>
						<h3>{engine.name}</h3>
					</div>
					<span class="source-status" class:enabled={engine.isEnabled}
						>{engine.isEnabled ? '已启用' : '已停用'}</span
					>
				</header>
				<p class="source-meta">分组：{engine.groupKey} · 标识：{engine.key}</p>
				{#if data.defaultEngine?.id === engine.id}<p class="source-default">首次访问默认</p>{/if}
				<code>{engine.urlTemplate}</code>
				<p class="source-note">提示：{engine.placeholder || `使用 ${engine.name} 搜索`}</p>
				{#if !engine.templateValid}<p class="field-error">
						模板需修正，当前不会在首页展示。请编辑并预览有效链接。
					</p>{/if}
				{#if data.source === 'database'}<div class="source-actions">
						<a
							class="admin-secondary-button"
							href={resolve(
								(data.listUrl +
									(data.listUrl.includes('?') ? '&' : '?') +
									`edit=${engine.id}`) as '/admin/search-engines'
							)}>编辑 / 预览</a
						>
						<form method="POST" action="?/toggle">
							<input type="hidden" name="id" value={engine.id} /><input
								type="hidden"
								name="expected"
								value={engine.isEnabled ? '1' : '0'}
							/><input type="hidden" name="returnTo" value={data.listUrl} /><button
								type="submit"
								class="admin-secondary-button"
								disabled={busy || Boolean(data.mode)}>{engine.isEnabled ? '停用' : '启用'}</button
							>
						</form>
						<form method="POST" action={moveUrl}>
							<input type="hidden" name="id" value={engine.id} /><input
								type="hidden"
								name="returnTo"
								value={data.listUrl}
							/><button
								class="admin-secondary-button"
								type="submit"
								name="direction"
								value="up"
								aria-label={`上移${engine.name}`}
								disabled={engine.position === 1 || busy || Boolean(data.mode)}>↑</button
							><button
								class="admin-secondary-button"
								type="submit"
								name="direction"
								value="down"
								aria-label={`下移${engine.name}`}
								disabled={engine.position === data.counts.total || busy || Boolean(data.mode)}
								>↓</button
							><button
								class="admin-secondary-button"
								type="submit"
								name="direction"
								value="first"
								disabled={!engine.isEnabled ||
									!engine.templateValid ||
									data.defaultEngine?.id === engine.id ||
									busy ||
									Boolean(data.mode)}>设为首次默认</button
							>
						</form>
						<details class="source-delete">
							<summary>删除</summary>
							<form method="POST" action="?/delete">
								<input type="hidden" name="id" value={engine.id} /><input
									type="hidden"
									name="returnTo"
									value={data.listUrl}
								/><label class="admin-checkbox"
									><input type="checkbox" name="confirmed" value="yes" required /><span
										>确认删除“{engine.name}”；保留此源可选择停用。</span
									></label
								><button
									type="submit"
									class="admin-danger-button"
									disabled={busy || Boolean(data.mode)}>确认删除</button
								>
							</form>
						</details>
					</div>{/if}
			</article>{:else}<div class="admin-empty-state">
				<strong>{data.counts.total ? '没有匹配的搜索源' : '还没有配置搜索源'}</strong>
				<p>
					{data.counts.total
						? '尝试调整关键词、分组或状态。'
						: '首页仍可使用站内搜索，添加搜索源可扩展其他入口。'}
				</p>
			</div>{/each}
	</div>
	<nav class="source-pagination" aria-label="搜索源分页">
		{#if data.page > 1}<a
				class="admin-secondary-button"
				href={resolve(
					searchSourceListUrl(params, { page: String(data.page - 1) }) as '/admin/search-engines'
				)}>上一页</a
			>{/if}<span>第 {data.page} / {data.pages} 页 · 共 {data.total} 条</span
		>{#if data.page < data.pages}<a
				class="admin-secondary-button"
				href={resolve(
					searchSourceListUrl(params, { page: String(data.page + 1) }) as '/admin/search-engines'
				)}>下一页</a
			>{/if}
	</nav>
</section>

<style>
	.source-summary {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
		margin: 20px 0;
	}
	.source-summary > div {
		display: grid;
		gap: 8px;
		padding: 16px;
		border: 1px solid var(--admin-border);
		border-radius: 10px;
		background: var(--admin-surface);
		color: var(--admin-muted);
	}
	.source-summary strong {
		font-size: 24px;
		color: var(--admin-text);
		overflow-wrap: anywhere;
	}
	.source-summary .default-name {
		font-size: 18px;
	}
	.source-note,
	.source-meta {
		color: var(--admin-muted);
		font-size: 14px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.source-editor {
		margin: 20px 0;
	}
	.source-preview-actions,
	.source-actions,
	.source-actions > form,
	.source-pagination {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.source-preview-actions {
		margin-top: 16px;
	}
	.source-preview {
		margin-top: 16px;
		padding: 16px;
		border: 1px solid var(--admin-border);
		border-radius: 10px;
		background: var(--admin-soft);
	}
	.source-preview h3 {
		margin: 0;
		scroll-margin-top: 90px;
	}
	.source-preview code,
	.source-card > code {
		display: block;
		font-size: 13px;
		line-height: 1.7;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
		color: var(--admin-text);
	}
	.source-list {
		margin-top: 24px;
		padding: 20px;
	}
	.source-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: end;
		margin: 20px 0;
	}
	.source-filters label {
		display: grid;
		gap: 6px;
		flex: 1 1 150px;
	}
	.source-filters input,
	.source-filters select {
		min-width: 0;
		min-height: 44px;
		border: 1px solid var(--admin-input-border);
		border-radius: 7px;
		padding: 8px 10px;
		color: var(--admin-text);
		background: var(--admin-surface);
	}
	.source-cards {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}
	.source-card {
		padding: 18px;
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		background: var(--admin-surface);
		min-width: 0;
	}
	.source-card header {
		display: flex;
		gap: 12px;
		justify-content: space-between;
		align-items: start;
	}
	.source-card h3 {
		margin: 4px 0;
		font-size: 18px;
		overflow-wrap: anywhere;
	}
	.source-card header > div {
		min-width: 0;
	}
	.source-card header small {
		color: var(--admin-muted);
		font-size: 13px;
	}
	.source-status {
		flex-shrink: 0;
		padding: 4px 8px;
		border-radius: 6px;
		background: var(--admin-soft);
		color: var(--admin-muted);
		font-size: 13px;
	}
	.source-status.enabled {
		color: var(--admin-success);
		background: var(--admin-success-soft);
	}
	.source-default {
		font-size: 13px;
		color: var(--admin-success);
	}
	.source-actions {
		border-top: 1px solid var(--admin-border);
		padding-top: 14px;
		margin-top: 14px;
	}
	.source-actions button,
	.source-actions a,
	.source-actions summary {
		min-height: 44px;
		min-width: 44px;
	}
	.source-delete summary {
		cursor: pointer;
		align-content: center;
		padding: 8px 12px;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
	}
	.source-delete form {
		display: grid;
		gap: 12px;
		margin-top: 12px;
	}
	.source-delete {
		max-width: 100%;
	}
	.source-pagination {
		justify-content: center;
		margin-top: 24px;
	}
	.source-editor fieldset {
		min-width: 0;
	}
	@media (max-width: 1000px) {
		.source-cards {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 600px) {
		.source-summary {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.source-list {
			padding: 14px;
		}
		.source-card {
			padding: 14px;
		}
	}
</style>
