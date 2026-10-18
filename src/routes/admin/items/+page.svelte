<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { tick, onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import AdminItemForm from '$lib/components/admin/AdminItemForm.svelte';
	import AdminContentRow from '$lib/components/admin/AdminContentRow.svelte';
	import {
		ADMIN_CONTENT_TYPES,
		BULK_CONTENT_ACTIONS,
		adminContentUrl,
		type BulkContentAction
	} from '$lib/admin-content';
	import { moveOrderedItem } from '$lib/content-ordering';
	import { searchShortcut } from '$lib/ui-actions';
	import { adminDialog } from '$lib/admin-actions';
	import type { Category, ContentType, Item, Tag } from '$lib/types/content';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const types = ADMIN_CONTENT_TYPES;
	const selectedItemIds = new SvelteSet<number>();
	let orderedItems = $derived([...data.items]),
		contentSearch = $derived(data.filters.q);
	let draggedItemId = $state<number | null>(null),
		sortSaving = $state(false),
		sortMessage = $state('');
	let editorDirty = $state(false),
		editorBusy = $state(false);
	let editingItem = $state<Item | null>(null),
		creatingModal = $state(false);
	let editorScrollY = $state(0),
		editorTrigger = $state<HTMLElement | null>(null),
		editorTriggerItemId = $state<number | null>(null),
		editorModal = $state<HTMLElement | null>(null);
	let contentDensity = $state<'comfortable' | 'compact'>('comfortable');
	let filterForm = $state<HTMLFormElement>();
	let bulkAction = $state<BulkContentAction>('publish'),
		bulkBusy = $state(false),
		bulkMessage = $state(''),
		bulkFailed = $state(false);
	const activeType = $derived(data.filters.type),
		contentCategoryFilter = $derived(data.filters.category);
	const sortingMode = $derived(data.filters.mode === 'sort');
	const filteredItems = $derived(orderedItems);
	const sortableScope = $derived(
		sortingMode && data.source === 'database' && data.orderComplete && filteredItems.length > 1
	);
	const allVisibleSelected = $derived(
		filteredItems.length > 0 && filteredItems.every((item) => selectedItemIds.has(item.id))
	);
	$effect(() => {
		void data.items;
		selectedItemIds.clear();
		sortMessage = '';
	});
	$effect(() => {
		if (data.source !== 'database') return;
		if (data.editing) {
			editingItem = data.editing;
			void focusFirstEditorControl();
		} else if (data.mode === 'create') {
			creatingModal = true;
			void focusFirstEditorControl();
		}
	});
	onMount(() => {
		try {
			if (localStorage.getItem('navinest.admin-density') === 'compact') contentDensity = 'compact';
		} catch {
			/* Storage is optional. */
		}
	});
	function density(value: 'comfortable' | 'compact') {
		contentDensity = value;
		try {
			localStorage.setItem('navinest.admin-density', value);
		} catch {
			/* Storage is optional. */
		}
	}
	function selectItem(id: number, selected: boolean) {
		if (bulkBusy || sortingMode) return;
		if (selected) selectedItemIds.add(id);
		else selectedItemIds.delete(id);
	}
	function selectAllVisible(selected: boolean) {
		if (bulkBusy || sortingMode) return;
		for (const item of filteredItems) {
			if (selected) selectedItemIds.add(item.id);
			else selectedItemIds.delete(item.id);
		}
	}
	async function bulkUpdate() {
		if (bulkBusy || !selectedItemIds.size) return;
		const ids = [...selectedItemIds];
		const label = BULK_CONTENT_ACTIONS.find((entry) => entry.value === bulkAction)!.label;
		if (!confirm(`将对明确勾选的 ${ids.length} 条内容执行“${label}”，是否继续？`)) return;
		bulkBusy = true;
		bulkFailed = false;
		bulkMessage = '正在保存批量操作…';
		try {
			const response = await fetch('/api/admin/items/bulk', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ids, action: bulkAction })
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? '批量操作失败，请稍后重试。');
			selectedItemIds.clear();
			const completedMessage = `已对 ${body.count} 条内容执行“${label}”。`;
			try {
				await invalidateAll();
				await tick();
				bulkMessage = completedMessage;
			} catch {
				bulkMessage = completedMessage + '列表刷新失败，请刷新页面查看结果。';
			}
		} catch (error) {
			bulkFailed = true;
			bulkMessage = error instanceof Error ? error.message : '批量操作失败，请稍后重试。';
		} finally {
			bulkBusy = false;
		}
	}
	function enterSortingMode() {
		const type = activeType === 'all' ? 'site' : activeType;
		const category =
			data.categories.find(
				(entry) => entry.type === type && String(entry.id) === contentCategoryFilter
			) ?? data.categories.find((entry) => entry.type === type);
		void goto(
			resolve(
				adminContentUrl(data.filters, {
					mode: 'sort',
					type,
					category: category ? String(category.id) : 'all',
					q: '',
					status: 'all',
					visibility: 'all',
					page: 1
				}) as '/'
			),
			{ keepFocus: true }
		);
	}
	function selectSortingType(type: ContentType) {
		const category = data.categories.find((entry) => entry.type === type);
		void goto(
			resolve(
				adminContentUrl(data.filters, {
					type,
					category: category ? String(category.id) : 'all',
					page: 1
				}) as '/'
			),
			{ keepFocus: true }
		);
	}
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
			byId = new Map(orderedItems.map((item) => [item.id, item]));
		orderedItems = itemIds.map((id) => byId.get(id)!);
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
			target = ids[ids.indexOf(id) + direction];
		if (target !== undefined) applyOrder(moveOrderedItem(ids, id, target));
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

	async function closeEditor() {
		if (editorBusy || (editorDirty && !confirm('内容尚未保存，确定关闭吗？'))) return;
		editorDirty = false;
		form = null;
		editingItem = null;
		creatingModal = false;
		if (data.mode)
			await goto(resolve(adminContentUrl(data.filters) as '/'), {
				replaceState: true,
				noScroll: true,
				keepFocus: true
			});
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
		await invalidateAll();
		editorBusy = false;
		await closeEditor();
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
		<p class="eyebrow">内容运营</p>
		<h1>内容管理</h1>
		<p class="admin-page-description">查找、整理和发布站内资源。</p>
		<div class="content-overview" aria-label="内容概览">
			<span><strong>{data.summary.total}</strong>全部</span><span
				><strong>{data.summary.published}</strong>已发布</span
			><span><strong>{data.summary.draft}</strong>草稿</span><span
				><strong>{data.summary.private}</strong>私有</span
			>
		</div>
	</div>
	{#if data.source === 'database'}<div class="content-header-actions">
			<a
				class="admin-secondary-button"
				href={resolve('/admin/link-checks')}
				aria-disabled={sortSaving || bulkBusy}
				onclick={(event) => {
					if (sortSaving || bulkBusy) event.preventDefault();
				}}>检查网址</a
			>
			<button
				class="admin-secondary-button"
				type="button"
				disabled={sortSaving || bulkBusy}
				onclick={sortingMode
					? () => goto(resolve(adminContentUrl(data.filters, { mode: 'browse', page: 1 }) as '/'))
					: enterSortingMode}>{sortingMode ? '退出排序' : '进入排序'}</button
			><button
				class="admin-primary-button"
				type="button"
				disabled={sortSaving || bulkBusy}
				onclick={() => openEditor(null)}>新增内容</button
			>
		</div>{/if}
</header>
{#if data.source === 'fallback'}<p class="admin-notice">本地示例为只读数据。</p>{/if}
{#if form?.message && !data.mode}<p class="admin-form-message" role="alert">{form.message}</p>{/if}
{#if bulkMessage}<p
		class="admin-bulk-feedback"
		class:error={bulkFailed}
		role={bulkFailed ? 'alert' : 'status'}
	>
		{bulkMessage}
	</p>{/if}

<div class="content-workbench">
	<section
		class="content-browser"
		aria-labelledby="content-browser-title"
		aria-busy={bulkBusy || sortSaving}
	>
		<div class="content-browser-header">
			<h2 id="content-browser-title">{sortingMode ? '分类内容排序' : '内容库'}</h2>
			<span
				>{data.total} 条{data.filters.q ? '匹配结果' : '内容'}{!sortingMode && data.pageCount > 1
					? ` · 第 ${data.filters.page} / ${data.pageCount} 页`
					: ''}</span
			>
		</div>
		{#if !sortingMode}<nav class="content-type-tabs" aria-label="内容类型">
				{#each types as type (type.value)}<a
						class:active={activeType === type.value}
						aria-current={activeType === type.value ? 'page' : undefined}
						href={resolve(
							adminContentUrl(data.filters, { type: type.value, category: 'all', page: 1 }) as '/'
						)}
						><span>{type.label}</span><strong
							>{type.value === 'all'
								? data.summary.total
								: (data.summary.types[type.value] ?? 0)}</strong
						></a
					>{/each}
			</nav>{/if}
		<form
			bind:this={filterForm}
			class="content-toolbar content-command-bar"
			method="GET"
			action={resolve('/admin/items')}
		>
			{#if activeType !== 'all'}<input type="hidden" name="type" value={activeType} />{/if}
			{#if sortingMode}<input type="hidden" name="mode" value="sort" /><label
					><span>内容类型</span><select
						value={activeType}
						disabled={sortSaving}
						onchange={(event) => selectSortingType(event.currentTarget.value as ContentType)}
						>{#each types.filter((type) => type.value !== 'all') as type (type.value)}<option
								value={type.value}>{type.label}</option
							>{/each}</select
					></label
				>
			{:else}<label class="content-search"
					><span class="sr-only">搜索内容</span><input
						name="q"
						type="search"
						bind:value={contentSearch}
						use:searchShortcut
						placeholder="搜索标题、用途、分类、标签或 Slug"
						maxlength="160"
						disabled={bulkBusy}
					/></label
				>{/if}
			<label
				><span class="sr-only">分类</span><select
					name="category"
					class="content-category-filter"
					value={contentCategoryFilter}
					disabled={sortSaving || bulkBusy}
					onchange={() => filterForm?.requestSubmit()}
					><option value="all">全部分类</option>{#if !sortingMode}<option value="none"
							>未分类</option
						>{/if}{#each data.categories.filter((category) => activeType === 'all' || category.type === activeType) as category (category.id)}<option
							value={String(category.id)}>{category.name}</option
						>{/each}</select
				></label
			>
			{#if !sortingMode}<label
					><span class="sr-only">状态</span><select
						name="status"
						class="content-status-filter"
						value={data.filters.status}
						disabled={bulkBusy}
						onchange={() => filterForm?.requestSubmit()}
						><option value="all">全部状态</option><option value="published">已发布</option><option
							value="draft">草稿</option
						></select
					></label
				><label
					><span class="sr-only">可见性</span><select
						name="visibility"
						class="content-visibility-filter"
						value={data.filters.visibility}
						disabled={bulkBusy}
						onchange={() => filterForm?.requestSubmit()}
						><option value="all">全部可见性</option><option value="public">公开</option><option
							value="private">私有</option
						></select
					></label
				>{/if}
			<button class="admin-secondary-button" type="submit" disabled={sortSaving || bulkBusy}
				>{sortingMode ? '查看分类' : '筛选'}</button
			>
			{#if !sortingMode}<a class="content-clear-filters" href={resolve('/admin/items')}>清除筛选</a
				>{/if}
		</form>
		<div class="content-library-meta">
			<span
				>{sortingMode
					? '排序包含该分类的全部状态与可见性。'
					: '筛选保存在地址中，刷新或返回后可继续工作。'}</span
			>
			<div class="content-density-toggle" aria-label="列表密度">
				<button
					type="button"
					aria-pressed={contentDensity === 'comfortable'}
					class:active={contentDensity === 'comfortable'}
					onclick={() => density('comfortable')}>舒适</button
				><button
					type="button"
					aria-pressed={contentDensity === 'compact'}
					class:active={contentDensity === 'compact'}
					onclick={() => density('compact')}>紧凑</button
				>
			</div>
		</div>
		{#if sortingMode}<div class="content-sort-bar enabled" role="status">
				{sortMessage ||
					(data.total > data.sortLimit
						? `该分类超过 ${data.sortLimit} 条，暂不支持整组排序；请通过编辑内容调整排序值。`
						: sortableScope
							? `共 ${data.total} 条，拖动手柄或使用上下按钮，调整后自动保存。`
							: '请选择至少包含两条内容的分类。')}
			</div>{/if}
		{#if selectedItemIds.size && !sortingMode}<div class="content-selection-bar">
				<strong>已选择 {selectedItemIds.size} 项</strong><label
					><span class="sr-only">批量操作</span><select bind:value={bulkAction} disabled={bulkBusy}
						>{#each BULK_CONTENT_ACTIONS as action (action.value)}<option value={action.value}
								>{action.label}</option
							>{/each}</select
					></label
				><button class="admin-primary-button" type="button" disabled={bulkBusy} onclick={bulkUpdate}
					>{bulkBusy ? '保存中…' : '应用到所选内容'}</button
				><button
					class="content-clear-filters"
					type="button"
					disabled={bulkBusy}
					onclick={() => selectedItemIds.clear()}>取消选择</button
				><small>仅作用于本页明确勾选的内容</small>
			</div>{/if}
		<div class="content-table-head">
			{#if !sortingMode && data.source === 'database'}<label
					><input
						type="checkbox"
						aria-label="全选本页内容"
						checked={allVisibleSelected}
						disabled={bulkBusy}
						onchange={(event) => selectAllVisible(event.currentTarget.checked)}
					/></label
				>{:else}<span></span>{/if}<span aria-hidden="true"></span><span>内容</span><span>状态</span
			><span>排序与更新</span><span>操作</span>
		</div>
		{#if !sortingMode && data.source === 'database'}<label class="content-mobile-select"
				><input
					type="checkbox"
					checked={allVisibleSelected}
					disabled={bulkBusy}
					onchange={(event) => selectAllVisible(event.currentTarget.checked)}
				/>全选本页内容</label
			>{/if}
		<div class="content-list" class:compact={contentDensity === 'compact'} aria-live="polite">
			{#each filteredItems as item, index (item.id)}<AdminContentRow
					{item}
					database={data.source === 'database'}
					selectable={!sortingMode && data.source === 'database'}
					busy={bulkBusy || sortSaving}
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
					<a class="admin-secondary-button" href={resolve('/admin/items')}>查看全部内容</a>
				</div>{/each}
		</div>
		{#if !sortingMode && data.pageCount > 1}<nav class="admin-pagination" aria-label="内容分页">
				<span>共 {data.total} 条 · 第 {data.filters.page} / {data.pageCount} 页</span>
				<div>
					{#if data.filters.page > 1}<a
							rel="prev"
							href={resolve(adminContentUrl(data.filters, { page: data.filters.page - 1 }) as '/')}
							>上一页</a
						>{/if}{#if data.filters.page < data.pageCount}<a
							rel="next"
							href={resolve(adminContentUrl(data.filters, { page: data.filters.page + 1 }) as '/')}
							>下一页</a
						>{/if}
				</div>
			</nav>{/if}
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
			use:adminDialog
			class="content-editor-modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="item-editor-title"
			tabindex="-1"
		>
			<div class="content-modal-header">
				<div>
					<p class="eyebrow">内容编辑</p>
					<h2 id="item-editor-title">{editingItem ? `编辑：${editingItem.title}` : '新增内容'}</h2>
				</div>
				<button type="button" aria-label="关闭编辑窗口" disabled={editorBusy} onclick={closeEditor}
					>×</button
				>
			</div>
			<div class="content-modal-body">
				<AdminItemForm
					bind:dirty={editorDirty}
					bind:busy={editorBusy}
					item={editingItem}
					categories={data.categories as Category[]}
					tags={data.tags as Tag[]}
					{form}
					initialType={activeType === 'all' ? 'site' : activeType}
					initialCategoryId={contentCategoryFilter === 'all' || contentCategoryFilter === 'none'
						? ''
						: contentCategoryFilter}
					action={editingItem ? '?/update' : '?/create'}
					onSaved={savedEditor}
					onCancel={closeEditor}
				/>
			</div>
		</div>
	</div>{/if}
