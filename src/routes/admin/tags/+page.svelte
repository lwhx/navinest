<script lang="ts">
	import { scrollableTable } from '$lib/admin-actions';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	function value(name: string, fallback = ''): string {
		const submitted = form?.values?.[name];
		return typeof submitted === 'string' ? submitted : fallback;
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Taxonomy</p>
		<h1>标签管理</h1>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/tags?create=1')}>新增标签</a
		>{/if}
</header>
{#if data.source === 'fallback'}<p class="admin-notice">本地示例为只读数据。</p>{/if}
{#if form?.message && !data.mode}<p class="admin-form-message" role="alert">{form.message}</p>{/if}

{#if data.source === 'database' && data.mode}
	<section class="admin-editor" aria-labelledby="tag-editor-title">
		<div class="admin-editor-header">
			<h2 id="tag-editor-title">{data.mode === 'create' ? '新增标签' : '编辑标签'}</h2>
			<a href={resolve('/admin/tags')} aria-label="关闭编辑器" title="关闭">×</a>
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
					<label
						><span>类型</span><select
							name="type"
							value={value('type', data.editing?.type ?? 'site')}
							><option value="site">网址</option><option value="post">文章</option><option
								value="app">APP / 资源</option
							><option value="book">书籍 / 影视</option><option value="bulletin">公告</option
							></select
						>{#if errors.type}<small class="field-error">{errors.type}</small>{/if}</label
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
					<label class="admin-field-wide"
						><span>说明</span><textarea name="description" rows="3" maxlength="500"
							>{value('description', data.editing?.description ?? '')}</textarea
						></label
					>
				</div>
				<div class="admin-form-actions">
					<button class="admin-primary-button" type="submit">保存标签</button><a
						class="admin-secondary-button"
						href={resolve('/admin/tags')}>取消</a
					>
				</div>
			</form>
		{:else}<p class="admin-notice">没有找到要编辑的标签。</p>{/if}
	</section>
{/if}

<div
	class="admin-table-wrap"
	use:scrollableTable
	role="region"
	aria-label="管理数据列表，可横向滚动"
>
	<table class="admin-table">
		<thead
			><tr
				><th>名称</th><th>Slug</th><th>类型</th>{#if data.source === 'database'}<th>操作</th
					>{/if}</tr
			></thead
		><tbody
			>{#each data.tags as tag (tag.id)}<tr
					><td><strong>{tag.name}</strong></td><td>{tag.slug}</td><td>{tag.type}</td
					>{#if data.source === 'database'}<td
							><div class="admin-row-actions">
								<a href={resolve(`/admin/tags?edit=${tag.id}`)}>编辑</a>
								<form
									method="POST"
									action="?/delete"
									onsubmit={(event) => {
										if (!confirm(`确定删除标签“${tag.name}”吗？`)) event.preventDefault();
									}}
								>
									<input type="hidden" name="id" value={tag.id} /><button type="submit">删除</button
									>
								</form>
							</div></td
						>{/if}</tr
				>{/each}</tbody
		>
	</table>
</div>
