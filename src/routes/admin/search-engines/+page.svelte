<script lang="ts">
	import { scrollableTable } from '$lib/admin-actions';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	function value(name: string, fallback = '') {
		const submitted = form?.values?.[name];
		return typeof submitted === 'string' ? submitted : fallback;
	}
	function enabled() {
		return form?.values ? value('isEnabled') === 'on' : data.editing?.isEnabled !== false;
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Search</p>
		<h1>搜索源</h1>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/search-engines?create=1')}>新增搜索源</a
		>{/if}
</header>
{#if data.source === 'fallback'}<p class="admin-notice">本地示例为只读数据。</p>{/if}
{#if data.source === 'database' && data.mode}<section class="admin-editor">
		<div class="admin-editor-header">
			<h2>{data.mode === 'create' ? '新增搜索源' : '编辑搜索源'}</h2>
			<a href={resolve('/admin/search-engines')} title="关闭">×</a>
		</div>
		{#if data.mode === 'create' || data.editing}<form
				class="admin-form"
				method="POST"
				action={data.mode === 'create' ? '?create=1&/create' : `?edit=${data.editing?.id}&/update`}
			>
				{#if data.editing}<input
						type="hidden"
						name="id"
						value={data.editing.id}
					/>{/if}{#if form?.message}<p class="admin-form-message">{form.message}</p>{/if}
				<div class="admin-form-grid">
					<label
						><span>分组</span><input
							name="groupKey"
							required
							maxlength="80"
							value={value('groupKey', data.editing?.groupKey ?? 'web')}
						/>{#if errors.groupKey}<small class="field-error">{errors.groupKey}</small>{/if}</label
					><label
						><span>名称</span><input
							name="name"
							required
							maxlength="80"
							value={value('name', data.editing?.name)}
						/>{#if errors.name}<small class="field-error">{errors.name}</small>{/if}</label
					><label
						><span>Key</span><input
							name="key"
							required
							pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
							value={value('key', data.editing?.key)}
						/>{#if errors.key}<small class="field-error">{errors.key}</small>{/if}</label
					><label
						><span>占位文本</span><input
							name="placeholder"
							maxlength="160"
							value={value('placeholder', data.editing?.placeholder ?? '')}
						/></label
					><label class="admin-field-wide"
						><span>URL 模板</span><input
							name="urlTemplate"
							required
							maxlength="2000"
							value={value('urlTemplate', data.editing?.urlTemplate)}
						/>{#if errors.urlTemplate}<small class="field-error">{errors.urlTemplate}</small
							>{/if}</label
					><label
						><span>排序</span><input
							name="sortOrder"
							type="number"
							value={value('sortOrder', String(data.editing?.sortOrder ?? 0))}
						/></label
					>
				</div>
				<label class="admin-checkbox"
					><input type="checkbox" name="isEnabled" checked={enabled()} /><span>启用</span></label
				>
				<div class="admin-form-actions">
					<button class="admin-primary-button" type="submit">保存搜索源</button><a
						class="admin-secondary-button"
						href={resolve('/admin/search-engines')}>取消</a
					>
				</div>
			</form>{:else}<p class="admin-notice">没有找到要编辑的搜索源。</p>{/if}
	</section>{/if}
<div
	class="admin-table-wrap"
	use:scrollableTable
	role="region"
	aria-label="管理数据列表，可横向滚动"
>
	<table class="admin-table">
		<thead
			><tr
				><th>名称</th><th>分组</th><th>Key</th><th>排序</th><th>启用</th
				>{#if data.source === 'database'}<th>操作</th>{/if}</tr
			></thead
		><tbody
			>{#each data.searchEngines as engine (engine.id)}<tr
					><td><strong>{engine.name}</strong></td><td>{engine.groupKey}</td><td>{engine.key}</td><td
						>{engine.sortOrder}</td
					><td>{engine.isEnabled ? '是' : '否'}</td>{#if data.source === 'database'}<td
							><div class="admin-row-actions">
								<a href={resolve(`/admin/search-engines?edit=${engine.id}`)}>编辑</a>
								<form
									method="POST"
									action="?/delete"
									onsubmit={(event) => {
										if (!confirm(`确定删除搜索源“${engine.name}”吗？`)) event.preventDefault();
									}}
								>
									<input type="hidden" name="id" value={engine.id} /><button type="submit"
										>删除</button
									>
								</form>
							</div></td
						>{/if}</tr
				>{/each}</tbody
		>
	</table>
</div>
