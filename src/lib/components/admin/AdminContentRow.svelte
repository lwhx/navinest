<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Item } from '$lib/types/content';
	let { item, database = true }: { item: Item; database?: boolean } = $props();
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

<article class="content-row" class:unpublished={item.status !== 'published'}>
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
			<a href={resolve(`/admin/items?edit=${item.id}`)}>编辑</a>
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
					type="submit"
					title="删除后会清理关联标签、元数据、收藏、足迹和统计记录">删除</button
				>
			</form>
		</div>{/if}
</article>
