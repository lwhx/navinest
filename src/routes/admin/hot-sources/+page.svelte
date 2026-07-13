<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let notice = $state('');
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	function val(name: string, fallback = '') {
		const v = form?.values?.[name];
		return typeof v === 'string' ? v : fallback;
	}
	async function refresh(id: number) {
		notice = '正在刷新…';
		const r = await fetch(`/api/admin/hot-sources/${id}/refresh`, { method: 'POST' }),
			body = await r.json();
		notice = r.ok ? `刷新成功，共 ${body.count} 条。` : body.error;
		if (r.ok) location.reload();
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Hot News</p>
		<h1>热榜源</h1>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/hot-sources?create=1')}>新增热榜源</a
		>{/if}
</header>
{#if notice}<p class="admin-form-message">{notice}</p>{/if}{#if data.source === 'fallback'}<p
		class="admin-notice"
	>
		数据库不可用。
	</p>{/if}
{#if data.source === 'database' && data.mode}<section class="admin-editor">
		<div class="admin-editor-header">
			<h2>{data.mode === 'create' ? '新增热榜源' : '编辑热榜源'}</h2>
			<a href={resolve('/admin/hot-sources')}>×</a>
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
						><span>名称</span><input
							name="name"
							required
							maxlength="100"
							value={val('name', data.editing?.name)}
						/>{#if errors.name}<small class="field-error">{errors.name}</small>{/if}</label
					><label
						><span>类型</span><select name="type"
							><option value="json" selected={val('type', data.editing?.type ?? 'json') === 'json'}
								>JSON</option
							><option value="rss" selected={val('type', data.editing?.type) === 'rss'}
								>RSS/Atom</option
							></select
						></label
					><label class="admin-field-wide"
						><span>公网 URL</span><input
							name="url"
							type="url"
							required
							maxlength="2000"
							value={val('url', data.editing?.url)}
						/>{#if errors.url}<small class="field-error">{errors.url}</small>{/if}</label
					><label class="admin-field-wide"
						><span>请求头 JSON（禁止凭据）</span><textarea name="headersJson"
							>{val('headersJson', JSON.stringify(data.editing?.headers ?? {}, null, 2))}</textarea
						>{#if errors.headersJson}<small class="field-error">{errors.headersJson}</small
							>{/if}</label
					><label class="admin-field-wide"
						><span>JSON 解析配置</span><textarea name="parserJson"
							>{val('parserJson', JSON.stringify(data.editing?.parser ?? {}, null, 2))}</textarea
						>{#if errors.parserJson}<small class="field-error">{errors.parserJson}</small
							>{/if}</label
					><label
						><span>缓存秒数</span><input
							name="cacheTtl"
							type="number"
							min="60"
							max="86400"
							value={val('cacheTtl', String(data.editing?.cacheTtl ?? 900))}
						/>{#if errors.cacheTtl}<small class="field-error">{errors.cacheTtl}</small>{/if}</label
					>
				</div>
				<label class="admin-checkbox"
					><input
						name="isEnabled"
						type="checkbox"
						checked={form?.values ? val('isEnabled') === 'on' : data.editing?.isEnabled !== false}
					/><span>启用</span></label
				>
				<div class="admin-form-actions">
					<button class="admin-primary-button" type="submit">保存</button><a
						class="admin-secondary-button"
						href={resolve('/admin/hot-sources')}>取消</a
					>
				</div>
			</form>{/if}
	</section>{/if}
<div class="admin-table-wrap">
	<table class="admin-table">
		<thead
			><tr><th>名称</th><th>类型</th><th>URL</th><th>上次刷新</th><th>启用</th><th>操作</th></tr
			></thead
		><tbody
			>{#each data.sources as source (source.id)}<tr
					><td><strong>{source.name}</strong></td><td>{source.type}</td><td>{source.url}</td><td
						>{source.lastFetchAt ?? '从未'}</td
					><td>{source.isEnabled ? '是' : '否'}</td><td
						><div class="admin-row-actions">
							<button type="button" onclick={() => refresh(source.id)}>刷新</button><a
								href={resolve(`/admin/hot-sources?edit=${source.id}`)}>编辑</a
							>
							<form
								method="POST"
								action="?/delete"
								onsubmit={(e) => {
									if (!confirm(`确定删除“${source.name}”吗？`)) e.preventDefault();
								}}
							>
								<input type="hidden" name="id" value={source.id} /><button type="submit"
									>删除</button
								>
							</form>
						</div></td
					></tr
				>{/each}</tbody
		>
	</table>
</div>
