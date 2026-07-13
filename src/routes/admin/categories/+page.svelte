<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);

	function value(name: string, fallback = ''): string {
		const submitted = form?.values?.[name];
		return typeof submitted === 'string' ? submitted : fallback;
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
						><span>父级分类</span><select
							name="parentId"
							value={value('parentId', String(data.editing?.parentId ?? ''))}
							><option value="">无父级</option
							>{#each data.categories.filter((category) => category.id !== data.editing?.id) as category (category.id)}<option
									value={category.id}>{category.name} · {category.type}</option
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

<div class="admin-table-wrap">
	<table class="admin-table">
		<thead
			><tr
				><th>名称</th><th>Slug</th><th>类型</th><th>排序</th><th>可见</th
				>{#if data.source === 'database'}<th>操作</th>{/if}</tr
			></thead
		>
		<tbody
			>{#each data.categories as category (category.id)}<tr
					><td><strong>{category.name}</strong></td><td>{category.slug}</td><td>{category.type}</td
					><td>{category.sortOrder}</td><td>{category.isVisible ? '是' : '否'}</td
					>{#if data.source === 'database'}<td
							><div class="admin-row-actions">
								<a href={resolve(`/admin/categories?edit=${category.id}`)}>编辑</a>
								<form
									method="POST"
									action="?/delete"
									onsubmit={(event) => {
										if (!confirm(`确定删除分类“${category.name}”吗？`)) event.preventDefault();
									}}
								>
									<input type="hidden" name="id" value={category.id} /><button type="submit"
										>删除</button
									>
								</form>
							</div></td
						>{/if}</tr
				>{/each}</tbody
		>
	</table>
</div>
