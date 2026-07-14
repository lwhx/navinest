<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
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
	const selectedItemIds = new SvelteSet<number>();
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
		editorScrollY = $state(0),
		editorTrigger = $state<HTMLElement | null>(null),
		editorTriggerItemId = $state<number | null>(null),
		editorModal = $state<HTMLElement | null>(null),
		contentDensity = $state<'comfortable' | 'compact'>('comfortable');
	$effect(() => {
		if (filtersInitialized) return;
		activeType = (
			types.some((type) => type.value === data.initialType) ? data.initialType : 'all'
		) as 'all' | ContentType;
		contentCategoryFilter = data.initialCategoryId || 'all';
		orderedItems = [...(data.items as Item[])];
		if (data.editing) {
			editingItem = data.editing as Item;
			void focusFirstEditorControl();
		} else if (data.mode === 'create') {
			creatingModal = true;
			void focusFirstEditorControl();
		}
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
	let allVisibleSelected = $derived(
		filteredItems.length > 0 && filteredItems.every((item) => selectedItemIds.has(item.id))
	);

	function selectItem(id: number, selected: boolean) {
		if (selected) selectedItemIds.add(id);
		else selectedItemIds.delete(id);
	}

	function selectAllVisible(selected: boolean) {
		for (const item of filteredItems) {
			if (selected) selectedItemIds.add(item.id);
			else selectedItemIds.delete(item.id);
		}
	}

	function clearFilters() {
		contentSearch = '';
		contentCategoryFilter = 'all';
		contentStatusFilter = 'all';
		contentVisibilityFilter = 'all';
		selectedItemIds.clear();
	}

	function selectContentType(type: 'all' | ContentType) {
		activeType = type;
		selectedItemIds.clear();
		if (
			contentCategoryFilter !== 'all' &&
			!data.categories.some(
				(category) =>
					String(category.id) === contentCategoryFilter &&
					(type === 'all' || category.type === type)
			)
		)
			contentCategoryFilter = 'all';
	}

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

	async function focusFirstEditorControl() {
		await tick();
		const target =
			editorModal?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea') ??
			editorModal?.querySelector<HTMLElement>('button, [href]');
		target?.focus();
	}

	function openEditor(item: Item | null, trigger?: HTMLElement) {
		editorScrollY = window.scrollY;
		editorTrigger = trigger ?? (document.activeElement as HTMLElement | null);
		editorTriggerItemId = item?.id ?? null;
		editingItem = item;
		creatingModal = item === null;
		void focusFirstEditorControl();
	}

	function closeEditor() {
		editingItem = null;
		creatingModal = false;
		if (location.search.includes('edit=') || location.search.includes('create')) {
			const url = new URL(location.href);
			url.searchParams.delete('edit');
			url.searchParams.delete('create');
			history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
		}
		void restoreEditorContext();
	}

	async function restoreEditorContext() {
		await tick();
		setTimeout(() => {
			window.scrollTo({ top: editorScrollY });
			const fallback = editorTriggerItemId
				? document.querySelector<HTMLElement>(
						`[data-content-id="${editorTriggerItemId}"] .content-edit-button`
					)
				: null;
			const target = fallback ?? (editorTrigger?.isConnected ? editorTrigger : null);
			target?.focus({ preventScroll: true });
		}, 50);
	}

	function trapEditorFocus(event: KeyboardEvent) {
		if (event.key !== 'Tab' || !editorModal) return;
		const controls = [
			...editorModal.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		].filter((element) => element.offsetParent !== null);
		if (!controls.length) return;
		const first = controls[0],
			last = controls.at(-1)!;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	async function savedEditor() {
		closeEditor();
		await invalidateAll();
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if ((editingItem || creatingModal) && event.key === 'Escape') closeEditor();
		else if (editingItem || creatingModal) trapEditorFocus(event);
	}}
/>

<header class="admin-page-header">
	<div class="content-page-heading">
		<p class="eyebrow">Content Operations</p>
		<h1>内容管理</h1>
		<span>集中管理、筛选、排序并发布站内内容。</span>
		<div class="content-overview" aria-label="内容概览">
			<span><strong>{data.items.length}</strong>全部</span>
			<span
				><i class="published"></i><strong
					>{data.items.filter((item) => item.status === 'published').length}</strong
				>已发布</span
			>
			<span
				><i class="draft"></i><strong
					>{data.items.filter((item) => item.status !== 'published').length}</strong
				>草稿</span
			>
			<span
				><i class="private"></i><strong
					>{data.items.filter((item) => item.visibility !== 'public').length}</strong
				>私有</span
			>
		</div>
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

<div class="content-workbench">
	<section class="content-browser" aria-labelledby="content-browser-title">
		<div class="content-browser-header">
			<div>
				<p class="eyebrow">Library</p>
				<h2 id="content-browser-title">内容库</h2>
			</div>
			<span>{filteredItems.length} / {data.items.length}</span>
		</div>
		<nav class="content-type-tabs" aria-label="内容类型">
			{#each types as type (type.value)}<button
					type="button"
					class:active={activeType === type.value}
					onclick={() => selectContentType(type.value)}
					><span>{type.label}</span><strong>{typeCounts[type.value]}</strong></button
				>{/each}
		</nav>
		<div class="content-toolbar content-command-bar">
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
			<div class="content-density-toggle" aria-label="列表密度">
				<button
					type="button"
					class:active={contentDensity === 'comfortable'}
					onclick={() => (contentDensity = 'comfortable')}>舒适</button
				><button
					type="button"
					class:active={contentDensity === 'compact'}
					onclick={() => (contentDensity = 'compact')}>紧凑</button
				>
			</div>
			<button class="content-clear-filters" type="button" onclick={clearFilters}>清除筛选</button>
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
		{#if selectedItemIds.size}<div class="content-selection-bar" role="status">
				<div>
					<strong>已选择 {selectedItemIds.size} 项</strong><span
						>批量操作只作用于当前明确选择的内容。</span
					>
				</div>
				<div>
					<button type="button" onclick={() => selectedItemIds.clear()}>取消选择</button><button
						type="button"
						onclick={enterSortingMode}>进入排序</button
					>
				</div>
			</div>{/if}
		<div class="content-table-head">
			<label>
				<input
					type="checkbox"
					checked={allVisibleSelected}
					onchange={(event) => selectAllVisible(event.currentTarget.checked)}
				/>
				<span class="sr-only">全选当前结果</span>
			</label>
			<span aria-hidden="true"></span>
			<span>内容</span>
			<span>状态</span>
			<span>排序与更新</span>
			<span>操作</span>
		</div>
		<div class="content-list" class:compact={contentDensity === 'compact'} aria-live="polite">
			{#each filteredItems as item, index (item.id)}<AdminContentRow
					{item}
					database={data.source === 'database'}
					sortable={sortableScope && !sortSaving}
					first={index === 0}
					last={index === filteredItems.length - 1}
					selected={selectedItemIds.has(item.id)}
					onSelect={selectItem}
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
			bind:this={editorModal}
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
					{form}
					initialType={activeType === 'all' ? 'site' : activeType}
					initialCategoryId={contentCategoryFilter === 'all' ? '' : contentCategoryFilter}
					action={editingItem ? `?/update` : `?/create`}
					onSaved={savedEditor}
					onCancel={closeEditor}
				/>
			</div>
		</div>
	</div>{/if}
