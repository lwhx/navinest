<script lang="ts">
	import { resolve } from '$app/paths';
	import AdminItemForm from '$lib/components/admin/AdminItemForm.svelte';
	import AdminContentRow from '$lib/components/admin/AdminContentRow.svelte';
	import type { Category, ContentType, Item, Tag } from '$lib/types/content';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const types: Array<{ value: 'all' | ContentType; label: string }> = [
		{ value: 'all', label: '全部内容' },
		{ value: 'site', label: '网址' },
		{ value: 'post', label: '文章' },
		{ value: 'app', label: 'APP / 资源' },
		{ value: 'book', label: '书籍 / 影视' },
		{ value: 'bulletin', label: '公告' }
	];
	let activeType = $state<'all' | ContentType>('all'),
		contentSearch = $state(''),
		contentCategoryFilter = $state('all'),
		contentStatusFilter = $state('all'),
		contentVisibilityFilter = $state('all'),
		filtersInitialized = $state(false);
	$effect(() => {
		if (filtersInitialized) return;
		activeType = (
			types.some((type) => type.value === data.initialType) ? data.initialType : 'all'
		) as 'all' | ContentType;
		contentCategoryFilter = data.initialCategoryId || 'all';
		filtersInitialized = true;
	});
	let filteredItems = $derived(
		(data.items as Item[]).filter((item) => {
			const query = contentSearch.trim().toLowerCase();
			return (
				(activeType === 'all' || item.type === activeType) &&
				(contentCategoryFilter === 'all' ||
					String(item.categoryId ?? '') === contentCategoryFilter) &&
				(contentStatusFilter === 'all' || item.status === contentStatusFilter) &&
				(contentVisibilityFilter === 'all' || item.visibility === contentVisibilityFilter) &&
				(!query ||
					`${item.title} ${item.slug} ${item.summary ?? ''} ${item.category?.name ?? ''}`
						.toLowerCase()
						.includes(query))
			);
		})
	);
	let typeCounts = $derived(
		Object.fromEntries(
			types.map((type) => [
				type.value,
				type.value === 'all'
					? data.items.length
					: data.items.filter((item) => item.type === type.value).length
			])
		)
	);
	let createHref = $derived(
		`/admin/items?create=1${activeType !== 'all' ? `&type=${activeType}` : ''}${contentCategoryFilter !== 'all' ? `&category=${contentCategoryFilter}` : ''}`
	);
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Content</p>
		<h1>内容管理</h1>
		<span>集中管理网址、文章、资源、书籍和公告。</span>
	</div>
	{#if data.source === 'database'}<a class="admin-primary-button" href={resolve(createHref as '/')}
			>新增内容</a
		>{/if}
</header>
{#if data.source === 'fallback'}<p class="admin-notice">本地示例为只读数据。</p>{/if}
{#if form?.message && !data.mode}<p class="admin-form-message" role="alert">{form.message}</p>{/if}

<nav class="content-type-tabs" aria-label="内容类型">
	{#each types as type (type.value)}<button
			type="button"
			class:active={activeType === type.value}
			onclick={() => {
				activeType = type.value;
				if (
					contentCategoryFilter !== 'all' &&
					!data.categories.some(
						(category) =>
							String(category.id) === contentCategoryFilter &&
							(type.value === 'all' || category.type === type.value)
					)
				)
					contentCategoryFilter = 'all';
			}}><span>{type.label}</span><strong>{typeCounts[type.value]}</strong></button
		>{/each}
</nav>

<section class="content-summary" aria-label="内容概览">
	<div><strong>{data.items.length}</strong><span>全部内容</span></div>
	<div>
		<strong>{data.items.filter((item) => item.status === 'published').length}</strong><span
			>已发布</span
		>
	</div>
	<div>
		<strong>{data.items.filter((item) => item.status !== 'published').length}</strong><span
			>草稿</span
		>
	</div>
	<div>
		<strong>{data.items.filter((item) => item.visibility !== 'public').length}</strong><span
			>私有内容</span
		>
	</div>
</section>

<div class="content-workbench" class:editor-open={Boolean(data.mode)}>
	<section class="content-browser" aria-labelledby="content-browser-title">
		<div class="content-browser-header">
			<div>
				<p class="eyebrow">Library</p>
				<h2 id="content-browser-title">内容库</h2>
			</div>
			<span>{filteredItems.length} / {data.items.length}</span>
		</div>
		<div class="content-toolbar">
			<label class="content-search"
				><span class="sr-only">搜索内容</span><input
					bind:value={contentSearch}
					placeholder="搜索标题、Slug、摘要或分类"
				/></label
			>
			<label
				><span class="sr-only">分类</span><select
					class="content-category-filter"
					bind:value={contentCategoryFilter}
					><option value="all">全部分类</option
					>{#each data.categories.filter((category) => activeType === 'all' || category.type === activeType) as category (category.id)}<option
							value={String(category.id)}>{category.name}</option
						>{/each}</select
				></label
			>
			<label
				><span class="sr-only">状态</span><select
					class="content-status-filter"
					bind:value={contentStatusFilter}
					><option value="all">全部状态</option><option value="published">已发布</option><option
						value="draft">草稿</option
					></select
				></label
			>
			<label
				><span class="sr-only">可见性</span><select
					class="content-visibility-filter"
					bind:value={contentVisibilityFilter}
					><option value="all">全部可见性</option><option value="public">公开</option><option
						value="private">私有</option
					></select
				></label
			>
		</div>
		<div class="content-list" aria-live="polite">
			{#each filteredItems as item (item.id)}<AdminContentRow
					{item}
					database={data.source === 'database'}
				/>{:else}<div class="content-empty">
					<strong>没有匹配内容</strong>
					<p>调整类型、搜索词或筛选条件。</p>
				</div>{/each}
		</div>
	</section>

	{#if data.source === 'database' && data.mode}<aside
			class="content-editor"
			aria-labelledby="item-editor-title"
		>
			<div class="admin-editor-header">
				<div>
					<p class="eyebrow">Editor</p>
					<h2 id="item-editor-title">{data.mode === 'create' ? '新增内容' : '编辑内容'}</h2>
				</div>
				<a href={resolve('/admin/items')} aria-label="关闭编辑器" title="关闭">×</a>
			</div>
			{#if data.mode === 'create' || data.editing}<AdminItemForm
					item={data.editing as Item | null}
					categories={data.categories as Category[]}
					tags={data.tags as Tag[]}
					{form}
					initialType={activeType === 'all'
						? data.initialType === 'all'
							? 'site'
							: data.initialType
						: activeType}
					initialCategoryId={contentCategoryFilter === 'all'
						? data.initialCategoryId
						: contentCategoryFilter}
					action={data.mode === 'create'
						? '?create=1&/create'
						: `?edit=${data.editing?.id}&/update`}
				/>{:else}<p class="admin-notice">没有找到要编辑的内容。</p>{/if}
		</aside>{/if}
</div>
