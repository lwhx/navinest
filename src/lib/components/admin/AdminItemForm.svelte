<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
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
		action
	}: {
		item?: Item | null;
		categories: Category[];
		tags: Tag[];
		form?: FormState;
		initialType?: string;
		initialCategoryId?: string;
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
		return null;
	}

	let selectedType = $state('');
	let selectedCategory = $state(''),
		selectedIcon = $state(''),
		selectedCover = $state(''),
		formInitialized = $state(false);
	$effect(() => {
		if (!selectedType) selectedType = value('type', item?.type ?? initialType);
		if (!formInitialized) {
			selectedCategory = value('categoryId', String(item?.categoryId ?? initialCategoryId));
			selectedIcon = value('iconFileId', String(item?.iconFileId ?? ''));
			selectedCover = value('coverFileId', String(item?.coverFileId ?? ''));
			formInitialized = true;
		}
	});
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
	const availableCategories = $derived(
		categories.filter((category) => !selectedType || category.type === selectedType)
	);
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
</script>

<form class="admin-form" method="POST" {action}>
	{#if item}<input type="hidden" name="id" value={item.id} />{/if}
	{#if form?.message}<p class="admin-form-message" role="alert">{form.message}</p>{/if}

	<div class="admin-form-grid">
		<label>
			<span>内容类型</span>
			<select name="type" bind:value={selectedType}>
				<option value="site">网址</option><option value="post">文章</option><option value="app"
					>APP / 资源</option
				><option value="book">书籍 / 影视</option><option value="bulletin">公告</option>
			</select>
			{#if form?.errors?.type}<small class="field-error">{form.errors.type}</small>{/if}
		</label>

		<label>
			<span>分类</span>
			<select name="categoryId" bind:value={selectedCategory}>
				<option value="">未分类</option>
				{#each availableCategories as category (category.id)}
					<option value={String(category.id)}>{category.name}</option>
				{/each}
			</select>
			{#if form?.errors?.categoryId}<small class="field-error">{form.errors.categoryId}</small>{/if}
		</label>

		<label class="admin-field-wide">
			<span>标题</span>
			<input name="title" maxlength="160" required value={value('title', item?.title)} />
			{#if form?.errors?.title}<small class="field-error">{form.errors.title}</small>{/if}
		</label>

		<label>
			<span>Slug</span>
			<input
				name="slug"
				maxlength="100"
				pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
				required
				value={value('slug', item?.slug)}
			/>
			{#if form?.errors?.slug}<small class="field-error">{form.errors.slug}</small>{/if}
		</label>

		<label>
			<span>排序</span>
			<input
				name="sortOrder"
				type="number"
				min="-100000"
				max="100000"
				value={value('sortOrder', String(item?.sortOrder ?? 0))}
			/>
			{#if form?.errors?.sortOrder}<small class="field-error">{form.errors.sortOrder}</small>{/if}
		</label>

		<label>
			<span>发布状态</span>
			<select name="status" value={value('status', item?.status ?? 'draft')}>
				<option value="draft">草稿</option><option value="published">已发布</option>
			</select>
		</label>

		<label>
			<span>可见性</span>
			<select name="visibility" value={value('visibility', item?.visibility ?? 'public')}>
				<option value="public">公开</option><option value="private">私有</option>
			</select>
		</label>

		<label class="admin-field-wide">
			<span>摘要</span>
			<textarea name="summary" rows="3" maxlength="500"
				>{value('summary', item?.summary ?? '')}</textarea
			>
			{#if form?.errors?.summary}<small class="field-error">{form.errors.summary}</small>{/if}
		</label>

		<label>
			<span>内容图标</span>
			{#if mediaLoadFailed}<small class="field-error">媒体列表加载失败，其他字段仍可保存。</small
				>{/if}<select name="iconFileId" bind:value={selectedIcon}
				><option value="">不使用图标</option>{#each imageFiles as file (file.id)}<option
						value={String(file.id)}>#{file.id} · {file.objectKey}</option
					>{/each}</select
			>
			{#if form?.errors?.iconFileId}<small class="field-error">{form.errors.iconFileId}</small>{/if}
			{#if selectedIcon}<img
					class="admin-media-preview icon"
					src={resolve('/api/admin/files/[id]', { id: selectedIcon })}
					alt="当前内容图标预览"
				/>{/if}
		</label>
		<label>
			<span>内容封面</span><select name="coverFileId" bind:value={selectedCover}
				><option value="">不使用封面</option>{#each imageFiles as file (file.id)}<option
						value={String(file.id)}>#{file.id} · {file.objectKey}</option
					>{/each}</select
			>
			{#if form?.errors?.coverFileId}<small class="field-error">{form.errors.coverFileId}</small
				>{/if}
			{#if selectedCover}<img
					class="admin-media-preview cover"
					src={resolve('/api/admin/files/[id]', { id: selectedCover })}
					alt="当前内容封面预览"
				/>{/if}
		</label>

		<label class="admin-field-wide">
			<span>正文</span>
			<textarea name="content" rows="8" maxlength="100000"
				>{value('content', item?.content ?? '')}</textarea
			>
			{#if form?.errors?.content}<small class="field-error">{form.errors.content}</small>{/if}
		</label>
	</div>

	{#if selectedType === 'site'}
		<fieldset class="admin-form-section">
			<legend>网址信息</legend>
			<div class="admin-form-grid">
				<label
					><span>目标地址</span><input
						name="site_url"
						type="url"
						required
						value={value('site_url', item?.meta.site_url)}
					/></label
				>
				<label
					><span>网址类型</span><input
						name="site_type"
						maxlength="200"
						value={value('site_type', item?.meta.site_type)}
					/></label
				>
			</div>
			{#if form?.errors?.['meta.site_url']}<small class="field-error"
					>{form.errors['meta.site_url']}</small
				>{/if}
		</fieldset>
	{:else if selectedType === 'app'}
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

	<fieldset class="admin-form-section">
		<legend>标签</legend>
		{#if availableTags.length > 0}
			<div class="admin-check-grid">
				{#each availableTags as tag (tag.id)}
					<label
						><input type="checkbox" name="tagIds" value={tag.id} checked={tagChecked(tag)} />
						<span>{tag.name}</span></label
					>
				{/each}
			</div>
		{:else}
			<p class="admin-form-hint">该内容类型还没有标签。</p>
		{/if}
		{#if form?.errors?.tagIds}<small class="field-error">{form.errors.tagIds}</small>{/if}
	</fieldset>

	<label class="admin-checkbox"
		><input type="checkbox" name="isFeatured" checked={featuredChecked()} />
		<span>设为推荐内容</span></label
	>

	<div class="admin-form-actions">
		<button class="admin-primary-button" type="submit">保存内容</button>
		<a class="admin-secondary-button" href={resolve('/admin/items')}>取消</a>
	</div>
</form>

<style>
	.admin-media-preview {
		display: block;
		width: 72px;
		height: 72px;
		margin-top: 10px;
		border: 1px solid rgba(72, 75, 79, 0.12);
		border-radius: 10px;
		object-fit: cover;
	}
	.admin-media-preview.cover {
		width: 128px;
		height: 80px;
	}
</style>
