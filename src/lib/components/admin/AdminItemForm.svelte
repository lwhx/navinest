<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import CategoryParentPicker from './CategoryParentPicker.svelte';
	import MediaPicker from './MediaPicker.svelte';
	import { suggestedContentSlug } from '$lib/content-editor';
	import { isManagedCategoryType } from '$lib/category-types';
	import type { ContentType } from '$lib/types/content';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { Category, Item, Tag } from '$lib/types/content';
	import type { AdminFileRecord } from '$lib/server/services/admin-files';

	type FormState = {
		message?: string;
		errors?: Record<string, string>;
		values?: Record<string, string | string[]>;
	} | null;

	let {
		item = null,
		categories,
		tags,
		form = null,
		initialType = 'site',
		initialCategoryId = '',
		onSaved,
		onCancel,
		dirty = $bindable(false),
		busy = $bindable(false),
		action
	}: {
		item?: Item | null;
		categories: Category[];
		tags: Tag[];
		form?: FormState;
		initialType?: string;
		initialCategoryId?: string;
		onSaved?: () => void | Promise<void>;
		onCancel?: () => void;
		dirty?: boolean;
		busy?: boolean;
		action: string;
	} = $props();

	function value(name: string, fallback = ''): string {
		const submitted = form?.values?.[name];
		return typeof submitted === 'string' ? submitted : fallback;
	}

	function selectedTags(): string[] | null {
		const submitted = form?.values?.tagIds;
		if (Array.isArray(submitted)) return submitted;
		if (typeof submitted === 'string') return [submitted];
		return form?.values ? [] : null;
	}

	let selectedType = $state(
		untrack(() =>
			value('type', item?.type ?? (isManagedCategoryType(initialType) ? initialType : 'site'))
		)
	);
	let selectedCategory = $state(
		untrack(() =>
			value(
				'categoryId',
				String(
					item?.categoryId ??
						(categories.some(
							(category) =>
								String(category.id) === initialCategoryId && category.type === selectedType
						)
							? initialCategoryId
							: '')
				)
			)
		)
	);
	let selectedIcon = $state(untrack(() => value('iconFileId', String(item?.iconFileId ?? ''))));
	let selectedCover = $state(untrack(() => value('coverFileId', String(item?.coverFileId ?? ''))));
	let availableFiles = $state<AdminFileRecord[]>([]),
		mediaLoadFailed = $state(false);
	const imageFiles = $derived(availableFiles.filter((file) => file.mimeType?.startsWith('image/')));
	onMount(async () => {
		try {
			const response = await fetch(resolve('/api/admin/files'));
			if (!response.ok) throw new Error('Media listing failed');
			const body = (await response.json()) as { data?: AdminFileRecord[] };
			availableFiles = body.data ?? [];
		} catch {
			mediaLoadFailed = true;
		}
	});
	const availableTags = $derived(tags.filter((tag) => !selectedType || tag.type === selectedType));

	function tagChecked(tag: Tag): boolean {
		const submitted = selectedTags();
		return submitted
			? submitted.includes(String(tag.id))
			: Boolean(item?.tags.some((entry) => entry.slug === tag.slug));
	}

	function featuredChecked(): boolean {
		return form?.values ? value('isFeatured') === 'on' : Boolean(item?.isFeatured);
	}

	let title = $state(untrack(() => value('title', item?.title)));
	let summary = $state(untrack(() => value('summary', item?.summary ?? '')));
	let siteUrl = $state(untrack(() => value('site_url', item?.meta.site_url)));
	let content = $state(untrack(() => value('content', item?.content ?? '')));
	let slug = $state(untrack(() => value('slug', item?.slug)));
	let enriching = $state(false),
		enrichmentMessage = $state(''),
		saveError = $state('');
	let slugEdited = $state(false),
		slugSuffix = '';
	onMount(() => {
		slugSuffix = crypto.randomUUID();
	});
	const legacyType = $derived(item && !isManagedCategoryType(item.type));
	function suggestSlug() {
		if (!item && !slugEdited)
			slug = suggestedContentSlug(title, selectedType === 'site' ? siteUrl : '', slugSuffix);
	}
	beforeNavigate(({ cancel, willUnload }) => {
		if (willUnload) return;
		if (busy || (dirty && !confirm('内容尚未保存，确定离开吗？'))) cancel();
	});
	async function enrich() {
		if (enriching || !siteUrl) return;
		const requestedUrl = siteUrl;
		enriching = true;
		enrichmentMessage = '正在读取网页信息…';
		try {
			const response = await fetch(resolve('/api/admin/items/enrich'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: requestedUrl, excludeId: item?.id })
			});
			const body = await response.json();
			if (siteUrl !== requestedUrl || selectedType !== 'site') return;
			if (!response.ok) throw new Error(body.error ?? '读取失败，请手动填写。');
			if (!title.trim()) title = body.title.slice(0, 160);
			if (!summary.trim()) summary = body.description.slice(0, 500);
			suggestSlug();
			dirty = true;
			enrichmentMessage = body.duplicates.length
				? `发现已收录的网址：${body.duplicates.map((entry: { title: string }) => entry.title).join('、')}。请核对是否重复。`
				: '已读取网页信息，仅填入空白标题和摘要，请核对后保存。';
		} catch (error) {
			enrichmentMessage = error instanceof Error ? error.message : '读取失败，请手动填写。';
		} finally {
			enriching = false;
		}
	}
	const enhanceForm: SubmitFunction = ({ cancel }) => {
		if (busy) {
			cancel();
			return;
		}
		busy = true;
		saveError = '';
		return async ({ result, update }) => {
			try {
				if (result.type === 'redirect' || result.type === 'success') {
					dirty = false;
					if (onSaved) await onSaved();
					else {
						busy = false;
						await update();
					}
				} else if (result.type === 'failure') {
					await update({ reset: false });
				} else {
					saveError = '保存失败，请稍后重试。当前输入已保留。';
				}
			} catch {
				saveError = '保存请求已完成，但页面刷新失败，请刷新列表核对。';
			} finally {
				busy = false;
			}
		};
	};
</script>

<svelte:window
	onbeforeunload={(event) => {
		if (dirty || busy) {
			event.preventDefault();
			event.returnValue = '';
		}
	}}
/>
<form
	class="admin-form content-editor"
	method="POST"
	{action}
	use:enhance={enhanceForm}
	oninput={() => (dirty = true)}
	onchange={() => (dirty = true)}
>
	{#if item}<input type="hidden" name="id" value={item.id} />{/if}
	{#if form?.message}<p class="admin-form-message" role="alert">{form.message}</p>{/if}
	{#if saveError}<p class="admin-form-message" role="alert">{saveError}</p>{/if}
	{#if form?.errors}<ul class="field-error" aria-label="需要修正的字段">
			{#each Object.entries(form.errors) as [field, error] (field)}<li>{error}</li>{/each}
		</ul>{/if}
	<fieldset disabled={busy} class="editor-fields">
		<div class="admin-form-grid">
			<label
				><span>内容类型</span>
				<select
					name="type"
					aria-label="内容类型"
					bind:value={selectedType}
					onchange={() => {
						selectedCategory = '';
						enrichmentMessage = '';
					}}
				>
					{#if legacyType}<option value={item!.type}>历史内容（{item!.type}）</option>
					{:else}<option value="site">网址</option><option value="post">文章</option>{/if}
				</select></label
			>
			<p class="admin-form-hint">
				{selectedType === 'site'
					? '先粘贴网址，再补充标题与用途。'
					: selectedType === 'post'
						? '填写标题、摘要与正文，整理成自己的文章。'
						: '维护已有历史内容，保留原有类型与关联。'}
			</p>
			{#if selectedType === 'site'}
				<label class="admin-field-wide"
					><span>目标地址</span><input
						name="site_url"
						type="url"
						required
						maxlength="2048"
						bind:value={siteUrl}
						oninput={(event) => {
							siteUrl = event.currentTarget.value;
							enrichmentMessage = '';
							suggestSlug();
						}}
						placeholder="https://example.com"
					/></label
				>
				<div class="admin-field-wide">
					<button
						class="admin-secondary-button"
						type="button"
						disabled={enriching || !siteUrl}
						onclick={enrich}>{enriching ? '读取中…' : '读取网页信息'}</button
					>
					<p class="admin-form-hint" role="status">
						{enrichmentMessage || '自动补全空白标题与摘要，并检查是否已经收录。'}
					</p>
				</div>
			{/if}
			<label class="admin-field-wide"
				><span>标题</span><input
					name="title"
					maxlength="160"
					required
					bind:value={title}
					oninput={(event) => {
						title = event.currentTarget.value;
						suggestSlug();
					}}
				/></label
			>
			<label class="admin-field-wide"
				><span>摘要</span><textarea
					name="summary"
					rows="3"
					maxlength="500"
					bind:value={summary}
					placeholder={selectedType === 'site' ? '一句话说明这个网站能做什么' : '简要介绍文章内容'}
				></textarea></label
			>
			{#if selectedType !== 'site'}<label class="admin-field-wide"
					><span>正文</span><textarea
						name="content"
						rows="12"
						maxlength="100000"
						bind:value={content}></textarea></label
				>{/if}
			<div class="admin-field-wide">
				<CategoryParentPicker
					{categories}
					type={selectedType as ContentType}
					purpose="content"
					bind:value={selectedCategory}
					error={form?.errors?.categoryId}
				/>
			</div>
		</div>
		<fieldset class="admin-form-section">
			<legend>标签</legend>
			{#if availableTags.length}<div class="admin-check-grid">
					{#each availableTags as tag (tag.id)}<label
							><input type="checkbox" name="tagIds" value={tag.id} checked={tagChecked(tag)} /><span
								>{tag.name}</span
							></label
						>{/each}
				</div>{:else}<p class="admin-form-hint">该类型还没有标签，可稍后添加。</p>{/if}
		</fieldset>
		<details class="editor-extra">
			<summary>图标与封面</summary>
			{#if mediaLoadFailed}<p class="field-error">
					媒体列表加载失败，已选图片保留，其他字段仍可保存。
				</p>{/if}
			<div class="admin-form-grid">
				<MediaPicker
					onchange={() => (dirty = true)}
					name="iconFileId"
					label="内容图标"
					files={imageFiles}
					bind:value={selectedIcon}
				/><MediaPicker
					onchange={() => (dirty = true)}
					name="coverFileId"
					label="内容封面"
					files={imageFiles}
					bind:value={selectedCover}
				/>
			</div>
		</details>
		<details class="editor-extra">
			<summary>更多设置</summary>
			<div class="admin-form-grid">
				<label
					><span>Slug</span><input
						name="slug"
						aria-label="Slug"
						maxlength="100"
						pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
						bind:value={slug}
						oninput={() => (slugEdited = true)}
						placeholder="留空自动生成"
					/><small>详情页地址标识，可修改；已有地址保持原值。</small></label
				>
				<label
					><span>排序</span><input
						name="sortOrder"
						type="number"
						min="-100000"
						max="100000"
						value={value('sortOrder', String(item?.sortOrder ?? 0))}
					/></label
				>
				{#if selectedType === 'site'}<label
						><span>网址类型</span><input
							name="site_type"
							maxlength="200"
							value={value('site_type', item?.meta.site_type)}
						/></label
					><label class="admin-field-wide"
						><span>补充说明</span><textarea
							name="content"
							rows="6"
							maxlength="100000"
							bind:value={content}></textarea></label
					>{/if}
			</div>
		</details>
		{#if selectedType === 'app'}
			<fieldset class="admin-form-section">
				<legend>APP / 资源信息</legend>
				<div class="admin-form-grid">
					<label
						><span>平台</span><input
							name="app_platform"
							maxlength="200"
							value={value('app_platform', item?.meta.app_platform)}
						/></label
					>
					<label
						><span>下载地址</span><input
							name="app_download_url"
							type="url"
							value={value('app_download_url', item?.meta.app_download_url)}
						/></label
					>
				</div>
			</fieldset>
		{:else if selectedType === 'book'}
			<fieldset class="admin-form-section">
				<legend>书籍 / 影视信息</legend>
				<div class="admin-form-grid">
					<label
						><span>作者 / 主创</span><input
							name="book_author"
							maxlength="200"
							value={value('book_author', item?.meta.book_author)}
						/></label
					>
					<label
						><span>评分</span><input
							name="book_score"
							maxlength="30"
							value={value('book_score', item?.meta.book_score)}
						/></label
					>
					<label class="admin-field-wide"
						><span>资源地址</span><input
							name="book_download_url"
							type="url"
							value={value('book_download_url', item?.meta.book_download_url)}
						/></label
					>
				</div>
			</fieldset>
		{/if}

		<div class="admin-form-grid editor-publish">
			<label
				><span>发布状态</span><select name="status" value={value('status', item?.status ?? 'draft')}
					><option value="draft">草稿</option><option value="published">已发布</option></select
				></label
			>
			<label
				><span>可见性</span><select
					name="visibility"
					value={value('visibility', item?.visibility ?? 'public')}
					><option value="public">公开</option><option value="private">私有</option></select
				></label
			>
			<label class="admin-checkbox"
				><input type="checkbox" name="isFeatured" checked={featuredChecked()} /><span
					>设为推荐内容</span
				></label
			>
		</div>
	</fieldset>
	<div class="admin-form-actions editor-savebar">
		<span class="admin-form-hint" role="status"
			>{busy ? '正在保存…' : dirty ? '有未保存的修改' : '请核对后保存'}</span
		><button class="admin-primary-button" type="submit" disabled={busy}
			>{busy ? '保存中…' : '保存内容'}</button
		>{#if onCancel}<button
				class="admin-secondary-button"
				type="button"
				disabled={busy}
				onclick={onCancel}>取消</button
			>{:else}<a class="admin-secondary-button" href={resolve('/admin/items')}>取消</a>{/if}
	</div>
</form>

<style>
	.editor-fields {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	.editor-extra {
		border-top: 1px solid var(--admin-border);
		padding: 12px 0;
	}
	.editor-extra summary {
		cursor: pointer;
		min-height: 44px;
		align-content: center;
		font-weight: 600;
	}
	.editor-publish {
		margin-top: 20px;
	}
	.editor-savebar {
		position: sticky;
		bottom: 0;
		background: var(--admin-surface);
		align-items: center;
		border-top: 1px solid var(--admin-border);
		z-index: 2;
		flex-wrap: wrap;
	}
	.editor-savebar .admin-form-hint {
		margin-right: auto;
	}
</style>
