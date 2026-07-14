<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Item } from '$lib/types/content';
	let {
		item,
		database = true,
		sortable = false,
		first = false,
		last = false,
		selected = false,
		onSelect,
		onDragStart,
		onDragOver,
		onDrop,
		onMove,
		onEdit
	}: {
		item: Item;
		database?: boolean;
		sortable?: boolean;
		first?: boolean;
		last?: boolean;
		selected?: boolean;
		onSelect?: (id: number, selected: boolean) => void;
		onDragStart?: (id: number) => void;
		onDragOver?: (event: DragEvent) => void;
		onDrop?: (id: number) => void;
		onMove?: (id: number, direction: -1 | 1) => void;
		onEdit?: (item: Item, trigger: HTMLButtonElement) => void;
	} = $props();
	const typeLabels = {
		site: '网址',
		post: '文章',
		app: 'APP / 资源',
		book: '书籍 / 影视',
		bulletin: '公告'
	} as const;
	const typeSymbols = { site: '↗', post: '文', app: 'A', book: '书', bulletin: '!' } as const;
	const prefixes = {
		site: 'sites',
		post: 'posts',
		app: 'apps',
		book: 'books',
		bulletin: 'bulletins'
	} as const;
	let previewPath = $derived(`/${prefixes[item.type]}/${encodeURIComponent(item.slug)}`);
</script>

<article
	data-content-id={item.id}
	class="content-row"
	class:sortable
	class:unpublished={item.status !== 'published'}
	draggable={sortable}
	ondragstart={() => onDragStart?.(item.id)}
	ondragover={(event) => onDragOver?.(event)}
	ondrop={() => onDrop?.(item.id)}
>
	<label class="content-row-select">
		<span class="sr-only">选择 {item.title}</span>
		<input
			type="checkbox"
			checked={selected}
			onchange={(event) => onSelect?.(item.id, event.currentTarget.checked)}
		/>
	</label>
	{#if sortable}<div class="content-drag-controls">
			<button
				class="content-drag-handle"
				type="button"
				aria-label={`拖动${item.title}排序`}
				title="拖动排序">⋮⋮</button
			>
			<button
				type="button"
				aria-label={`上移${item.title}`}
				disabled={first}
				onclick={() => onMove?.(item.id, -1)}>↑</button
			>
			<button
				type="button"
				aria-label={`下移${item.title}`}
				disabled={last}
				onclick={() => onMove?.(item.id, 1)}>↓</button
			>
		</div>{/if}
	<div class="content-row-media">
		{#if item.iconFileId}<img
				src={resolve('/api/admin/files/[id]', { id: String(item.iconFileId) })}
				alt=""
			/>{:else}<span>{typeSymbols[item.type]}</span>{/if}
	</div>
	<div class="content-row-copy">
		<div>
			<strong>{item.title}</strong>{#if item.isFeatured}<em>推荐</em>{/if}
		</div>
		<p>{item.summary || item.slug}</p>
		<small>{item.category?.name ?? '未分类'} · {item.slug}</small>
	</div>
	<div class="content-row-badges">
		<span>{typeLabels[item.type]}</span>
		<span class:published={item.status === 'published'}
			>{item.status === 'published' ? '已发布' : '草稿'}</span
		>
		<span>{item.visibility === 'public' ? '公开' : '私有'}</span>
	</div>
	<div class="content-row-meta">
		<span>排序 {item.sortOrder}</span><time datetime={item.updatedAt}
			>{item.updatedAt.slice(0, 10)}</time
		>
	</div>
	{#if database}<div class="content-row-actions">
			<button
				class="content-edit-button"
				type="button"
				onclick={(event) => onEdit?.(item, event.currentTarget)}>编辑</button
			>
			<details class="content-row-menu">
				<summary aria-label={`${item.title}更多操作`}>•••</summary>
				<div>
					<a href={resolve(previewPath as '/')}>前台预览</a>
					<form
						method="POST"
						action="?/delete"
						onsubmit={(event) => {
							if (
								!confirm(
									`确定删除内容“${item.title}”吗？\n删除后会清理关联标签、元数据、收藏、足迹和统计记录，且无法撤销。`
								)
							)
								event.preventDefault();
						}}
					>
						<input type="hidden" name="id" value={item.id} /><button
							class="danger"
							type="submit"
							title="删除后会清理关联标签、元数据、收藏、足迹和统计记录">删除内容</button
						>
					</form>
				</div>
			</details>
		</div>{/if}
</article>
