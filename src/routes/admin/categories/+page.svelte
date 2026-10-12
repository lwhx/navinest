<script lang="ts">
	import { resolve } from '$app/paths';
	import { isManagedCategoryType, managedCategoryTypes } from '$lib/category-types';
	import CategoryTreeNode from '$lib/components/CategoryTreeNode.svelte';
	import type { CategoryWorkbenchNode } from '$lib/server/services/category-workbench';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	let categorySearch = $state(''),
		categoryTypeFilter = $state('all'),
		categoryVisibilityFilter = $state('all');

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
	let filteredRoots = $derived(data.workbench.roots.flatMap((root) => matches(root) ?? []));
	const legacyEditor = $derived(Boolean(data.editing && !isManagedCategoryType(data.editing.type)));
	let selectedType = $derived(legacyEditor ? data.editing!.type : managedType()),
		selectedParent = $derived(
			value('parentId', String(data.editing?.parentId ?? data.createParent?.id ?? ''))
		);

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
					<label
						><span id="category-parent-label">父级分类</span><select
							name="parentId"
							aria-labelledby="category-parent-label"
							><option value="" selected={selectedParent === ''}>无父级</option
							>{#each data.categories.filter((category) => category.id !== data.editing?.id && category.type === selectedType) as category (category.id)}<option
									value={category.id}
									selected={selectedParent === String(category.id)}>{category.name}</option
								>{/each}</select
						>{#if errors.parentId}<small class="field-error">{errors.parentId}</small>{/if}</label
					>
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
	<div><strong>{data.workbench.summary.children}</strong><span>二级分类</span></div>
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
		<div class="category-tree" aria-live="polite">
			{#each filteredRoots as root (root.id)}<CategoryTreeNode
					node={root}
					database={data.source === 'database'}
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
