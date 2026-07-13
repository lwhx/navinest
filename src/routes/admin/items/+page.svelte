<script lang="ts">
	import { resolve } from '$app/paths';
	import AdminItemForm from '$lib/components/admin/AdminItemForm.svelte';
	import type { Category, Item, Tag } from '$lib/types/content';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Content</p>
		<h1>内容管理</h1>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/items?create=1')}>新增内容</a
		>{/if}
</header>
{#if data.source === 'fallback'}<p class="admin-notice">本地示例为只读数据。</p>{/if}
{#if form?.message && !data.mode}<p class="admin-form-message" role="alert">{form.message}</p>{/if}

{#if data.source === 'database' && data.mode}
	<section class="admin-editor" aria-labelledby="item-editor-title">
		<div class="admin-editor-header">
			<h2 id="item-editor-title">{data.mode === 'create' ? '新增内容' : '编辑内容'}</h2>
			<a href={resolve('/admin/items')} aria-label="关闭编辑器" title="关闭">×</a>
		</div>
		{#if data.mode === 'create' || data.editing}
			<AdminItemForm
				item={data.editing as Item | null}
				categories={data.categories as Category[]}
				tags={data.tags as Tag[]}
				{form}
				action={data.mode === 'create' ? '?create=1&/create' : `?edit=${data.editing?.id}&/update`}
			/>
		{:else}<p class="admin-notice">没有找到要编辑的内容。</p>{/if}
	</section>
{/if}

<div class="admin-table-wrap">
	<table class="admin-table">
		<thead
			><tr
				><th>标题</th><th>类型</th><th>分类</th><th>状态</th><th>可见性</th
				>{#if data.source === 'database'}<th>操作</th>{/if}</tr
			></thead
		><tbody
			>{#each data.items as item (item.id)}<tr
					><td><strong>{item.title}</strong><small>{item.slug}</small></td><td>{item.type}</td><td
						>{typeof item.category === 'string'
							? item.category
							: (item.category?.name ?? '未分类')}</td
					><td><span class="status-badge">{item.status}</span></td><td>{item.visibility}</td
					>{#if data.source === 'database'}<td
							><div class="admin-row-actions">
								<a href={resolve(`/admin/items?edit=${item.id}`)}>编辑</a>
								<form
									method="POST"
									action="?/delete"
									onsubmit={(event) => {
										if (!confirm(`确定删除内容“${item.title}”吗？`)) event.preventDefault();
									}}
								>
									<input type="hidden" name="id" value={item.id} /><button type="submit"
										>删除</button
									>
								</form>
							</div></td
						>{/if}</tr
				>{/each}</tbody
		>
	</table>
</div>
