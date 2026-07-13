<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import AdminItemForm from '$lib/components/admin/AdminItemForm.svelte';
	import AdminContentRow from '$lib/components/admin/AdminContentRow.svelte';
	import { moveOrderedItem } from '$lib/content-ordering';
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
		filtersInitialized = $state(false),
		orderedItems = $state<Item[]>([]),
		draggedItemId = $state<number | null>(null),
		sortSaving = $state(false),
		sortMessage = $state(''),
		sortingMode = $state(false),
		editingItem = $state<Item | null>(null),
		creatingModal = $state(false),
		editorScrollY = $state(0);
	$effect(() => {
		if (filtersInitialized) return;
		activeType = (
			types.some((type) => type.value === data.initialType) ? data.initialType : 'all'
		) as 'all' | ContentType;
		contentCategoryFilter = data.initialCategoryId || 'all';
		orderedItems = [...(data.items as Item[])];
		filtersInitialized = true;
	});
	let filteredItems = $derived(
		orderedItems.filter((item) => {
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

	let sortableScope = $derived(
		sortingMode &&
			data.source === 'database' &&
			activeType !== 'all' &&
			contentCategoryFilter !== 'all' &&
			!contentSearch.trim() &&
			contentStatusFilter === 'all' &&
			contentVisibilityFilter === 'all' &&
			filteredItems.length > 1
	);

	async function saveOrder(itemIds: number[], previous: Item[]) {
		sortSaving = true;
		sortMessage = '正在保存顺序…';
		try {
			const response = await fetch('/api/admin/items/order', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					type: activeType,
					categoryId: Number(contentCategoryFilter),
					itemIds
				})
			});
			const body = response.ok ? null : await response.json();
			if (!response.ok) throw new Error(body?.error ?? '排序保存失败。');
			sortMessage = '顺序已保存。';
		} catch (error) {
			orderedItems = previous;
			sortMessage = error instanceof Error ? error.message : '排序保存失败，已恢复原顺序。';
		} finally {
			sortSaving = false;
		}
	}

	function applyOrder(itemIds: number[]) {
		const previous = [...orderedItems],
			byId = new Map(orderedItems.map((item) => [item.id, item])),
			scope = new Set(itemIds);
		let index = 0;
		orderedItems = orderedItems.map((item) =>
			scope.has(item.id) ? (byId.get(itemIds[index++]) ?? item) : item
		);
		void saveOrder(itemIds, previous);
	}

	function dropOn(targetId: number) {
		if (!sortableScope || sortSaving || draggedItemId === null) return;
		const ids = filteredItems.map((item) => item.id),
			next = moveOrderedItem(ids, draggedItemId, targetId);
		draggedItemId = null;
		if (next.some((id, index) => id !== ids[index])) applyOrder(next);
	}

	function moveItem(id: number, direction: -1 | 1) {
		if (!sortableScope || sortSaving) return;
		const ids = filteredItems.map((item) => item.id),
			index = ids.indexOf(id),
			target = ids[index + direction];
		if (target === undefined) return;
		applyOrder(moveOrderedItem(ids, id, target));
	}

	function enterSortingMode() {
		sortingMode = true;
		contentSearch = '';
		contentStatusFilter = 'all';
		contentVisibilityFilter = 'all';
		if (activeType === 'all') activeType = 'site';
		const firstCategory = data.categories.find(
			(category) =>
				category.type === activeType &&
				orderedItems.filter((item) => item.type === activeType && item.categoryId === category.id)
					.length > 1
		);
		if (
			contentCategoryFilter === 'all' ||
			!data.categories.some(
				(category) => String(category.id) === contentCategoryFilter && category.type === activeType
			)
		)
			contentCategoryFilter = firstCategory ? String(firstCategory.id) : 'all';
		sortMessage = '';
	}

	function selectSortingType(type: ContentType) {
		activeType = type;
		const category = data.categories.find(
			(entry) =>
				entry.type === type &&
				orderedItems.filter((item) => item.type === type && item.categoryId === entry.id).length > 1
		);
		contentCategoryFilter = category ? String(category.id) : 'all';
		sortMessage = '';
	}

	function openEditor(item: Item | null) {
		editorScrollY = window.scrollY;
		editingItem = item;
		creatingModal = item === null;
	}

	function closeEditor() {
		editingItem = null;
		creatingModal = false;
		requestAnimationFrame(() => window.scrollTo({ top: editorScrollY }));
	}

	async function savedEditor() {
		closeEditor();
		await invalidateAll();
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if ((editingItem || creatingModal) && event.key === 'Escape') closeEditor();
	}}
/>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Content</p>
		<h1>内容管理</h1>
		<span>集中管理网址、文章、资源、书籍和公告。</span>
	</div>
	{#if data.source === 'database'}<div class="content-header-actions">
			<button
				class="admin-secondary-button"
				type="button"
				onclick={sortingMode ? () => (sortingMode = false) : enterSortingMode}
				>{sortingMode ? '退出排序' : '进入排序'}</button
			>
			<button class="admin-primary-button" type="button" onclick={() => openEditor(null)}
				>新增内容</button
			>
		</div>{/if}
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
		<div class="content-sort-bar" class:enabled={sortingMode} role="status">
			{#if sortingMode}<div class="content-sort-settings">
					<strong>手动排序模式</strong>
					<label
						><span>内容类型</span><select
							value={activeType}
							onchange={(event) => selectSortingType(event.currentTarget.value as ContentType)}
							><option value="site">网址</option><option value="post">文章</option><option
								value="app">APP / 资源</option
							><option value="book">书籍 / 影视</option><option value="bulletin">公告</option
							></select
						></label
					>
					<label
						><span>分类</span><select bind:value={contentCategoryFilter}
							><option value="all">请选择分类</option
							>{#each data.categories.filter((category) => category.type === activeType) as category (category.id)}<option
									value={String(category.id)}>{category.name}</option
								>{/each}</select
						></label
					>
					<span
						>{sortMessage ||
							(sortableScope
								? '拖动手柄或使用上下按钮调整顺序，松开后自动保存。'
								: '请选择至少包含两条内容的分类。')}</span
					>
				</div>{:else}<span>点击页面右上角“进入排序”，选择分类后即可直接拖拽。</span>{/if}
		</div>
		<div class="content-list" aria-live="polite">
			{#each filteredItems as item, index (item.id)}<AdminContentRow
					{item}
					database={data.source === 'database'}
					sortable={sortableScope && !sortSaving}
					first={index === 0}
					last={index === filteredItems.length - 1}
					onDragStart={(id) => (draggedItemId = id)}
					onDragOver={(event) => event.preventDefault()}
					onDrop={dropOn}
					onMove={moveItem}
					onEdit={openEditor}
				/>{:else}<div class="content-empty">
					<strong>没有匹配内容</strong>
					<p>调整类型、搜索词或筛选条件。</p>
				</div>{/each}
		</div>
	</section>
</div>

{#if editingItem || creatingModal}<div
		class="content-editor-backdrop"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) closeEditor();
		}}
	>
		<div
			class="content-editor-modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="item-editor-title"
			tabindex="-1"
		>
			<div class="content-modal-header">
				<div>
					<p class="eyebrow">Editor</p>
					<h2 id="item-editor-title">{editingItem ? `编辑：${editingItem.title}` : '新增内容'}</h2>
				</div>
				<button type="button" aria-label="关闭编辑窗口" onclick={closeEditor}>×</button>
			</div>
			<div class="content-modal-body">
				<AdminItemForm
					item={editingItem}
					categories={data.categories as Category[]}
					tags={data.tags as Tag[]}
					initialType={activeType === 'all' ? 'site' : activeType}
					initialCategoryId={contentCategoryFilter === 'all' ? '' : contentCategoryFilter}
					action={editingItem ? `?/update` : `?/create`}
					onSaved={savedEditor}
					onCancel={closeEditor}
				/>
			</div>
		</div>
	</div>{/if}
