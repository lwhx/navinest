<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { isManagedCategoryType, managedCategoryTypes } from '$lib/category-types';
	import CategoryTreeNode from '$lib/components/CategoryTreeNode.svelte';
	import CategoryParentPicker from '$lib/components/admin/CategoryParentPicker.svelte';
	import { moveOrderedItem } from '$lib/content-ordering';
	import type { CategoryWorkbenchNode } from '$lib/server/services/category-workbench';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	let categorySearch = $state(''),
		categoryTypeFilter = $state('all'),
		categoryVisibilityFilter = $state('all');
	let treeDraft = $state<CategoryWorkbenchNode[] | null>(null),
		sortBusy = $state(false),
		sortFailed = $state(false),
		sortMessage = $state(''),
		draggedCategoryId = $state<number | null>(null);
	const browsableRoots = $derived(treeDraft ?? data.workbench.roots);

	function matches(node: CategoryWorkbenchNode): CategoryWorkbenchNode | null {
		const children = node.children.flatMap((child) => {
			const match = matches(child);
			return match ? [match] : [];
		});
		const query = categorySearch.trim().toLowerCase(),
			textMatch = !query || `${node.name} ${node.slug} ${node.path}`.toLowerCase().includes(query),
			typeMatch = categoryTypeFilter === 'all' || node.type === categoryTypeFilter,
			visibilityMatch =
				categoryVisibilityFilter === 'all' ||
				(categoryVisibilityFilter === 'visible' ? node.isVisible : !node.isVisible);
		return (textMatch && typeMatch && visibilityMatch) || children.length
			? { ...node, children }
			: null;
	}
	let filteredRoots = $derived(browsableRoots.flatMap((root) => matches(root) ?? []));
	// Ordering submits the complete sibling list, so it is only offered on the
	// unfiltered tree — a filtered view would silently drop hidden siblings.
	const sortableTree = $derived(
		data.source === 'database' &&
			!data.mode &&
			!sortBusy &&
			!categorySearch.trim() &&
			categoryTypeFilter === 'all' &&
			categoryVisibilityFilter === 'all'
	);
	const legacyEditor = $derived(Boolean(data.editing && !isManagedCategoryType(data.editing.type)));
	let selectedType = $derived(legacyEditor ? data.editing!.type : managedType()),
		selectedParent = $derived(
			value('parentId', String(data.editing?.parentId ?? data.createParent?.id ?? ''))
		);
	$effect(() => {
		void data.workbench;
		treeDraft = null;
		sortMessage = '';
	});

	function value(name: string, fallback = ''): string {
		const submitted = form?.values?.[name];
		return typeof submitted === 'string' ? submitted : fallback;
	}
	function managedType() {
		const type = value('type', data.editing?.type ?? data.createParent?.type ?? 'site');
		return isManagedCategoryType(type) ? type : 'site';
	}

	function visibleChecked(): boolean {
		return form?.values ? value('isVisible') === 'on' : data.editing?.isVisible !== false;
	}

	function deepCopyNodes(nodes: CategoryWorkbenchNode[]): CategoryWorkbenchNode[] {
		return nodes.map((node) => ({ ...node, children: deepCopyNodes(node.children) }));
	}
	function locateSiblings(
		nodes: CategoryWorkbenchNode[],
		id: number,
		parentId: number | null
	): { list: CategoryWorkbenchNode[]; parentId: number | null; type: string } | null {
		for (const node of nodes) {
			if (node.id === id) return { list: nodes, parentId, type: node.type };
			const found = locateSiblings(node.children, id, node.id);
			if (found) return found;
		}
		return null;
	}
	/**
	 * Reorders one type's subsequence inside a shared sibling array (top level mixes
	 * types); resolveTarget receives the same-type id list and returns the swap target.
	 */
	function reorderTypedSiblings(
		list: CategoryWorkbenchNode[],
		id: number,
		resolveTarget: (ids: number[]) => number | undefined
	) {
		const type = list.find((node) => node.id === id)?.type;
		if (!type) return null;
		const sameType = list.filter((node) => node.type === type),
			ids = sameType.map((node) => node.id),
			target = resolveTarget(ids);
		if (target === undefined || target === id) return null;
		const next = moveOrderedItem(ids, id, target);
		if (next.every((value, index) => value === ids[index])) return null;
		const queue = next.map((value) => sameType.find((node) => node.id === value)!);
		list.splice(
			0,
			list.length,
			...list.map((node) => (node.type === type ? queue.shift()! : node))
		);
		return { type, categoryIds: next };
	}
	function reorderSiblings(id: number, resolveTarget: (ids: number[]) => number | undefined) {
		if (!treeDraft) return;
		const scope = locateSiblings(treeDraft, id, null),
			previous = treeDraft;
		if (!scope) return;
		const outcome = reorderTypedSiblings(scope.list, id, resolveTarget);
		if (!outcome) return;
		void saveCategoryOrder(outcome.type, scope.parentId, outcome.categoryIds, previous);
	}
	async function saveCategoryOrder(
		type: string,
		parentId: number | null,
		categoryIds: number[],
		previous: CategoryWorkbenchNode[]
	) {
		sortBusy = true;
		sortFailed = false;
		sortMessage = '正在保存顺序…';
		try {
			const response = await fetch('/api/admin/categories/order', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ type, parentId, categoryIds })
			});
			const body = response.ok ? null : await response.json();
			if (!response.ok) throw new Error(body?.error ?? '排序保存失败。');
			const completed = '分类顺序已保存。';
			treeDraft = null;
			try {
				await invalidateAll();
				sortMessage = completed;
			} catch {
				sortMessage = completed + '树刷新失败，请刷新页面核对。';
			}
		} catch (error) {
			treeDraft = previous;
			sortFailed = true;
			sortMessage = error instanceof Error ? error.message : '排序保存失败，已恢复原顺序。';
		} finally {
			sortBusy = false;
		}
	}
	function moveCategory(id: number, direction: -1 | 1) {
		if (!sortableTree) return;
		if (!treeDraft) treeDraft = deepCopyNodes(data.workbench.roots);
		if (!locateSiblings(treeDraft, id, null)) return;
		reorderSiblings(id, (ids) => ids[ids.indexOf(id) + direction]);
	}
	function dropOnCategory(targetId: number) {
		if (!sortableTree || draggedCategoryId === null || draggedCategoryId === targetId) return;
		if (!treeDraft) treeDraft = deepCopyNodes(data.workbench.roots);
		const dragged = draggedCategoryId;
		draggedCategoryId = null;
		reorderSiblings(dragged, () => targetId);
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Taxonomy</p>
		<h1>分类管理</h1>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/categories?create=1')}>新增分类</a
		>{/if}
</header>
{#if data.source === 'fallback'}<p class="admin-notice">本地示例为只读数据。</p>{/if}
{#if form?.message && !data.mode}<p class="admin-form-message" role="alert">{form.message}</p>{/if}
{#if data.flash}<p class="admin-form-message" role="status">
		{data.flash === 'created'
			? '分类已创建。'
			: data.flash === 'updated'
				? '分类已保存。'
				: '分类已删除。'}
	</p>{/if}
{#if sortMessage}<p
		class="admin-form-message"
		class:error={sortFailed}
		role={sortFailed ? 'alert' : 'status'}
	>
		{sortMessage}
	</p>{/if}

{#if data.source === 'database' && data.mode}
	<section class="admin-editor" aria-labelledby="category-editor-title">
		<div class="admin-editor-header">
			<h2 id="category-editor-title">{data.mode === 'create' ? '新增分类' : '编辑分类'}</h2>
			<a href={resolve('/admin/categories')} aria-label="关闭编辑器" title="关闭">×</a>
		</div>
		{#if data.mode === 'create' || data.editing}
			<form
				class="admin-form"
				method="POST"
				action={data.mode === 'create' ? '?create=1&/create' : `?edit=${data.editing?.id}&/update`}
			>
				{#if data.editing}<input type="hidden" name="id" value={data.editing.id} />{/if}
				{#if form?.message}<p class="admin-form-message" role="alert">{form.message}</p>{/if}
				<div class="admin-form-grid">
					{#if legacyEditor}
						<div class="admin-field-wide">
							<input type="hidden" name="type" value={data.editing!.type} />
							<p class="admin-notice">
								历史分类：保留原类型和内容关联，仅维护现有分类，不再新增此类型。
							</p>
							{#if errors.type}<small class="field-error">{errors.type}</small>{/if}
						</div>
					{:else}
						<label
							><span id="category-type-label">类型</span><select
								name="type"
								aria-labelledby="category-type-label"
								bind:value={selectedType}
								onchange={() => (selectedParent = '')}
							>
								{#each managedCategoryTypes as type (type.value)}<option value={type.value}
										>{type.label}</option
									>{/each}
							</select>{#if errors.type}<small class="field-error">{errors.type}</small>{/if}</label
						>
					{/if}
					<CategoryParentPicker
						categories={data.categories}
						type={selectedType}
						editingId={data.editing?.id}
						bind:value={selectedParent}
						error={errors.parentId}
					/>
					<label
						><span>名称</span><input
							name="name"
							maxlength="80"
							required
							value={value('name', data.editing?.name)}
						/>{#if errors.name}<small class="field-error">{errors.name}</small>{/if}</label
					>
					<label
						><span>Slug</span><input
							name="slug"
							maxlength="100"
							pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
							required
							value={value('slug', data.editing?.slug)}
						/>{#if errors.slug}<small class="field-error">{errors.slug}</small>{/if}</label
					>
					<label
						><span>图标</span><input
							name="icon"
							maxlength="100"
							value={value('icon', data.editing?.icon ?? '')}
						/></label
					>
					<label
						><span>排序</span><input
							name="sortOrder"
							type="number"
							min="-100000"
							max="100000"
							value={value('sortOrder', String(data.editing?.sortOrder ?? 0))}
						/></label
					>
					<label class="admin-field-wide"
						><span>说明</span><textarea name="description" rows="3" maxlength="500"
							>{value('description', data.editing?.description ?? '')}</textarea
						></label
					>
				</div>
				<label class="admin-checkbox"
					><input type="checkbox" name="isVisible" checked={visibleChecked()} />
					<span>前台可见</span></label
				>
				<div class="admin-form-actions">
					<button class="admin-primary-button" type="submit">保存分类</button><a
						class="admin-secondary-button"
						href={resolve('/admin/categories')}>取消</a
					>
				</div>
			</form>
		{:else}<p class="admin-notice">没有找到要编辑的分类。</p>{/if}
	</section>
{/if}

<section class="category-summary" aria-label="分类概览">
	<div><strong>{data.workbench.summary.total}</strong><span>网址与文章分类</span></div>
	<div><strong>{data.workbench.summary.roots}</strong><span>一级分类</span></div>
	<div><strong>{data.workbench.summary.children}</strong><span>子分类</span></div>
	<div><strong>{data.workbench.summary.hidden}</strong><span>已隐藏</span></div>
</section>

<div class="category-workbench" class:editor-open={Boolean(data.mode)}>
	<section class="category-browser" aria-labelledby="category-browser-title">
		<div class="category-browser-header">
			<div>
				<p class="eyebrow">Structure</p>
				<h2 id="category-browser-title">分类结构</h2>
			</div>
			<span>{filteredRoots.length} 个匹配结果</span>
		</div>
		<div class="category-toolbar">
			<label class="category-search"
				><span class="sr-only">搜索分类</span><input
					bind:value={categorySearch}
					placeholder="搜索名称、Slug或路径"
				/></label
			>
			<label
				><span class="sr-only">内容类型</span><select
					class="category-type-filter"
					bind:value={categoryTypeFilter}
					><option value="all">全部类型</option
					>{#each managedCategoryTypes as type (type.value)}<option value={type.value}
							>{type.label}</option
						>{/each}</select
				></label
			>
			<label
				><span class="sr-only">可见性</span><select
					class="category-visibility-filter"
					bind:value={categoryVisibilityFilter}
					><option value="all">全部状态</option><option value="visible">前台可见</option><option
						value="hidden">已隐藏</option
					></select
				></label
			>
		</div>
		{#if sortableTree}<div class="category-sort-hint" role="status">
				拖动 ⋮⋮ 或使用上下按钮调整同层分类顺序，调整后自动保存。
			</div>{:else if !data.mode && data.source === 'database'}<div class="category-sort-hint">
				清除搜索或筛选后即可拖动排序。
			</div>{/if}
		<div class="category-tree" aria-live="polite">
			{#each filteredRoots as root, index (root.id)}<CategoryTreeNode
					node={root}
					database={data.source === 'database'}
					sortable={sortableTree && !sortBusy}
					first={index === 0}
					last={index === filteredRoots.length - 1}
					busy={sortBusy}
					onDragStart={(id) => (draggedCategoryId = id)}
					onDragOver={(event) => event.preventDefault()}
					onDrop={dropOnCategory}
					onMove={moveCategory}
				/>{:else}<div class="category-empty">
					<strong>没有匹配分类</strong>
					<p>调整搜索词或筛选条件后再试。</p>
				</div>{/each}
		</div>
	</section>

	{#if !data.mode}<aside class="category-guidance">
			<strong>使用提示</strong>
			<ul>
				<li>点击“快速新增子分类”会自动预选父级。</li>
				<li>无筛选时可直接拖动 ⋮⋮ 或使用上下按钮调整同层顺序。</li>
				<li>内容数包含当前分类及其子分类内容。</li>
				<li>有子分类或直属内容的分类不能直接删除。</li>
			</ul>
		</aside>{/if}
</div>

{#if data.workbench.legacy.summary.total}
	<details class="category-legacy">
		<summary>历史分类（{data.workbench.legacy.summary.total}）</summary>
		<p>已有分类及内容保留在这里，仍可编辑或隐藏，不再新增此类型分类。</p>
		<div class="category-tree">
			{#each data.workbench.legacy.roots as root (root.id)}<CategoryTreeNode
					node={root}
					database={data.source === 'database'}
				/>{/each}
		</div>
	</details>
{/if}
