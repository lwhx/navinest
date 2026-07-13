<script lang="ts">
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
		<p class="eyebrow">Homepage</p>
		<h1>首页模块</h1>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/home-modules?create=1')}>新增模块</a
		>{/if}
</header>
{#if data.source === 'fallback'}<p class="admin-notice">本地示例为只读数据。</p>{/if}
{#if data.source === 'database' && data.mode}<section class="admin-editor">
		<div class="admin-editor-header">
			<h2>{data.mode === 'create' ? '新增模块' : '编辑模块'}</h2>
			<a href={resolve('/admin/home-modules')} title="关闭">×</a>
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
						><span>类型</span><select
							name="type"
							value={value('type', data.editing?.type ?? 'content')}
							><option value="search">搜索</option><option value="content">内容</option><option
								value="hot">热榜</option
							><option value="ranking">排行</option><option value="links">链接</option><option
								value="custom_html">自定义 HTML</option
							></select
						>{#if errors.type}<small class="field-error">{errors.type}</small>{/if}</label
					><label
						><span>标题</span><input
							name="title"
							required
							maxlength="100"
							value={value('title', data.editing?.title)}
						/>{#if errors.title}<small class="field-error">{errors.title}</small>{/if}</label
					><label
						><span>排序</span><input
							name="sortOrder"
							type="number"
							value={value('sortOrder', String(data.editing?.sortOrder ?? 0))}
						/></label
					><label class="admin-field-wide"
						><span>JSON 配置</span><textarea name="configJson" rows="6"
							>{value('configJson', JSON.stringify(data.editing?.config ?? {}, null, 2))}</textarea
						>{#if errors.configJson}<small class="field-error">{errors.configJson}</small
							>{/if}</label
					>
				</div>
				<label class="admin-checkbox"
					><input type="checkbox" name="isEnabled" checked={enabled()} /><span>启用</span></label
				>
				<div class="admin-form-actions">
					<button class="admin-primary-button" type="submit">保存模块</button><a
						class="admin-secondary-button"
						href={resolve('/admin/home-modules')}>取消</a
					>
				</div>
			</form>{:else}<p class="admin-notice">没有找到要编辑的模块。</p>{/if}
	</section>{/if}
<div class="admin-table-wrap">
	<table class="admin-table">
		<thead
			><tr
				><th>标题</th><th>类型</th><th>排序</th><th>启用</th>{#if data.source === 'database'}<th
						>操作</th
					>{/if}</tr
			></thead
		><tbody
			>{#each data.modules as module (module.id)}<tr
					><td><strong>{module.title}</strong></td><td>{module.type}</td><td>{module.sortOrder}</td
					><td>{module.isEnabled ? '是' : '否'}</td>{#if data.source === 'database'}<td
							><div class="admin-row-actions">
								<a href={resolve(`/admin/home-modules?edit=${module.id}`)}>编辑</a>
								<form
									method="POST"
									action="?/delete"
									onsubmit={(event) => {
										if (!confirm(`确定删除模块“${module.title}”吗？`)) event.preventDefault();
									}}
								>
									<input type="hidden" name="id" value={module.id} /><button type="submit"
										>删除</button
									>
								</form>
							</div></td
						>{/if}</tr
				>{/each}</tbody
		>
	</table>
</div>
