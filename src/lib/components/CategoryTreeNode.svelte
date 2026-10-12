<script lang="ts">
	import { resolve } from '$app/paths';
	import { isManagedCategoryType } from '$lib/category-types';
	import CategoryTreeNode from './CategoryTreeNode.svelte';
	import type { CategoryWorkbenchNode } from '$lib/server/services/category-workbench';
	let { node, database = true }: { node: CategoryWorkbenchNode; database?: boolean } = $props();
	let expanded = $state(true);
	const typeLabels: Record<string, string> = {
		site: '网址',
		post: '文章',
		app: 'APP / 资源',
		book: '书籍 / 影视',
		bulletin: '公告'
	};
</script>

<article class="category-tree-node" class:hidden-category={!node.isVisible}>
	<div class="category-node-main">
		<button
			class="category-expand"
			type="button"
			aria-label={expanded ? `收起${node.name}` : `展开${node.name}`}
			aria-expanded={expanded}
			disabled={node.children.length === 0}
			onclick={() => (expanded = !expanded)}
			>{node.children.length ? (expanded ? '−' : '+') : '·'}</button
		>
		<span class="category-node-icon" aria-hidden="true"
			>{node.icon?.slice(0, 2) || node.name.slice(0, 1)}</span
		>
		<div class="category-node-copy">
			<div>
				<strong>{node.name}</strong><span>{typeLabels[node.type] ?? node.type}</span
				>{#if !node.isVisible}<em>已隐藏</em>{/if}
			</div>
			<p>{node.path}</p>
		</div>
		<div class="category-node-metrics">
			<span><strong>{node.totalItemCount}</strong> 内容</span>
			<span><strong>{node.childCount}</strong> 子分类</span>
		</div>
		{#if database}<div class="category-node-actions">
				<a href={resolve(`/admin/categories?edit=${node.id}`)}>编辑</a>
				{#if isManagedCategoryType(node.type)}<a
						href={resolve(`/admin/categories?create=1&parent=${node.id}`)}>快速新增子分类</a
					>{/if}
				<form
					method="POST"
					action="?/delete"
					title={node.deleteImpact}
					onsubmit={(event) => {
						if (!node.canDelete || !confirm(`确定删除分类“${node.name}”吗？\n${node.deleteImpact}`))
							event.preventDefault();
					}}
				>
					<input type="hidden" name="id" value={node.id} /><button
						type="submit"
						disabled={!node.canDelete}>删除</button
					>
				</form>
			</div>{/if}
	</div>
	{#if expanded && node.children.length}<div class="category-tree-children">
			{#each node.children as child (child.id)}<CategoryTreeNode node={child} {database} />{/each}
		</div>{/if}
</article>
