<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let notice = $state('');
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	function val(name: string, fallback: string | number = '') {
		const value = form?.values?.[name];
		return typeof value === 'string' ? value : String(fallback ?? '');
	}
	async function refresh(id: number) {
		notice = '正在测试并刷新订阅…';
		const response = await fetch(`/api/admin/hot-sources/${id}/refresh`, { method: 'POST' }),
			body = await response.json();
		notice = response.ok ? `刷新成功，共获取 ${body.count} 条。` : body.error;
		if (response.ok) setTimeout(() => location.reload(), 500);
	}
</script>

<header class="admin-page-header hot-admin-header">
	<div>
		<p class="eyebrow">RSS Hot Boards</p>
		<h1>热点榜单</h1>
		<span>添加一个RSSHub、RSS、Atom或JSON订阅，即生成一个独立榜单。</span>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/hot-sources?create=1')}>添加榜单</a
		>{/if}
</header>
{#if notice}<p class="admin-form-message" role="status">{notice}</p>{/if}
{#if data.source === 'fallback'}<p class="admin-notice">数据库不可用。</p>{/if}

{#if data.source === 'database' && data.mode}<section class="admin-editor hot-board-editor">
		<div class="admin-editor-header">
			<div>
				<p class="eyebrow">BOARD DESIGN</p>
				<h2>{data.mode === 'create' ? '添加热点榜单' : `编辑：${data.editing?.name}`}</h2>
			</div>
			<a href={resolve('/admin/hot-sources')} aria-label="关闭编辑器">×</a>
		</div>
		{#if data.mode === 'create' || data.editing}<form
				class="admin-form"
				method="POST"
				action={data.mode === 'create' ? '?create=1&/create' : `?edit=${data.editing?.id}&/update`}
			>
				{#if data.editing}<input type="hidden" name="id" value={data.editing.id} />{/if}
				{#if form?.message}<p class="admin-form-message">{form.message}</p>{/if}
				<fieldset class="admin-form-section">
					<legend>榜单身份</legend>
					<div class="admin-form-grid">
						<label
							><span>榜单名称</span><input
								name="name"
								required
								maxlength="100"
								value={val('name', data.editing?.name)}
							/>{#if errors.name}<small class="field-error">{errors.name}</small>{/if}</label
						>
						<label
							><span>唯一标识</span><input
								name="slug"
								required
								pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
								placeholder="baidu-hot"
								value={val('slug', data.editing?.slug)}
							/>{#if errors.slug}<small class="field-error">{errors.slug}</small>{/if}</label
						>
						<label
							><span>图标或简称</span><input
								name="icon"
								maxlength="8"
								placeholder="百 / 🔥"
								value={val('icon', data.editing?.icon ?? '热')}
							/>{#if errors.icon}<small class="field-error">{errors.icon}</small>{/if}</label
						>
						<label class="admin-field-wide"
							><span>榜单说明</span><textarea
								name="description"
								maxlength="300"
								rows="2"
								placeholder="说明榜单内容和来源"
								>{val('description', data.editing?.description)}</textarea
							>{#if errors.description}<small class="field-error">{errors.description}</small
								>{/if}</label
						>
					</div>
				</fieldset>
				<fieldset class="admin-form-section">
					<legend>订阅与解析</legend>
					<div class="admin-form-grid">
						<label
							><span>订阅类型</span><select name="type"
								><option value="rss" selected={val('type', data.editing?.type ?? 'rss') === 'rss'}
									>RSSHub / RSS / Atom</option
								><option value="json" selected={val('type', data.editing?.type) === 'json'}
									>自定义 JSON API</option
								></select
							></label
						>
						<label
							><span>缓存秒数</span><input
								name="cacheTtl"
								type="number"
								min="60"
								max="86400"
								value={val('cacheTtl', data.editing?.cacheTtl ?? 900)}
							/>{#if errors.cacheTtl}<small class="field-error">{errors.cacheTtl}</small
								>{/if}</label
						>
						<label class="admin-field-wide"
							><span>RSSHub / RSS / API 公网URL</span><input
								name="url"
								type="url"
								required
								maxlength="2000"
								placeholder="https://rsshub.example.com/baidu/top"
								value={val('url', data.editing?.url)}
							/>{#if errors.url}<small class="field-error">{errors.url}</small>{/if}<small
								>RSSHub任意路由均可直接作为独立榜单；禁止内网和带凭据URL。</small
							></label
						>
						<details class="admin-field-wide advanced-config">
							<summary>高级请求与JSON解析配置</summary><label
								><span>请求头JSON（禁止凭据）</span><textarea name="headersJson"
									>{val(
										'headersJson',
										JSON.stringify(data.editing?.headers ?? {}, null, 2)
									)}</textarea
								>{#if errors.headersJson}<small class="field-error">{errors.headersJson}</small
									>{/if}</label
							><label
								><span>JSON解析配置</span><textarea name="parserJson"
									>{val(
										'parserJson',
										JSON.stringify(data.editing?.parser ?? {}, null, 2)
									)}</textarea
								>{#if errors.parserJson}<small class="field-error">{errors.parserJson}</small
									>{/if}</label
							>
						</details>
					</div>
				</fieldset>
				<fieldset class="admin-form-section">
					<legend>外观与展示</legend>
					<div class="admin-form-grid">
						<label
							><span>主题色</span><input
								name="accentColor"
								type="color"
								value={val('accentColor', data.editing?.accentColor ?? '#e5484d')}
							/>{#if errors.accentColor}<small class="field-error">{errors.accentColor}</small
								>{/if}</label
						>
						<label
							><span>背景色</span><input
								name="surfaceColor"
								type="color"
								value={val('surfaceColor', data.editing?.surfaceColor ?? '#fff7f7')}
							/>{#if errors.surfaceColor}<small class="field-error">{errors.surfaceColor}</small
								>{/if}</label
						>
						<label
							><span>显示条数</span><input
								name="displayLimit"
								type="number"
								min="5"
								max="50"
								value={val('displayLimit', data.editing?.displayLimit ?? 20)}
							/>{#if errors.displayLimit}<small class="field-error">{errors.displayLimit}</small
								>{/if}</label
						>
						<label
							><span>榜单布局</span><select name="layout"
								><option
									value="list"
									selected={val('layout', data.editing?.layout ?? 'list') === 'list'}
									>标准榜单</option
								><option
									value="compact"
									selected={val('layout', data.editing?.layout) === 'compact'}>紧凑榜单</option
								><option
									value="columns"
									selected={val('layout', data.editing?.layout) === 'columns'}>双栏榜单</option
								></select
							></label
						>
						<label
							><span>排序值</span><input
								name="sortOrder"
								type="number"
								min="-10000"
								max="10000"
								value={val('sortOrder', data.editing?.sortOrder ?? 0)}
							/>{#if errors.sortOrder}<small class="field-error">{errors.sortOrder}</small
								>{/if}</label
						>
					</div>
					<div class="board-switches">
						<label class="admin-checkbox"
							><input
								name="showDescription"
								type="checkbox"
								checked={form?.values
									? val('showDescription') === 'on'
									: data.editing?.showDescription === true}
							/><span>显示RSS摘要</span></label
						><label class="admin-checkbox"
							><input
								name="isEnabled"
								type="checkbox"
								checked={form?.values
									? val('isEnabled') === 'on'
									: data.editing?.isEnabled !== false}
							/><span>启用榜单</span></label
						>
					</div>
				</fieldset>
				<div class="admin-form-actions">
					<button class="admin-primary-button" type="submit">保存榜单</button><a
						class="admin-secondary-button"
						href={resolve('/admin/hot-sources')}>取消</a
					>
				</div>
			</form>{/if}
	</section>{/if}

<section class="hot-board-admin-grid" aria-label="热点榜单列表">
	{#each data.sources as source (source.id)}<article
			class:disabled={!source.isEnabled}
			class="hot-board-admin-card"
			style={`--accent:${source.accentColor};--surface:${source.surfaceColor}`}
		>
			<header>
				<span>{source.icon}</span>
				<div>
					<strong>{source.name}</strong><small
						>{source.type === 'rss' ? 'RSSHUB / RSS / ATOM' : 'JSON API'} · 排序 {source.sortOrder}</small
					>
				</div>
				<em>{source.isEnabled ? '启用' : '停用'}</em>
			</header>
			<p>{source.description || '未填写榜单说明'}</p>
			<div class="board-config-chips">
				<span>{source.layout}</span><span>{source.displayLimit}条</span><span
					>{source.cacheTtl}秒缓存</span
				><span>{source.showDescription ? '显示摘要' : '隐藏摘要'}</span>
			</div>
			<div class="board-url">{source.url}</div>
			<footer>
				<div>
					<small>最后成功</small><strong
						>{source.lastSuccessAt ?? source.lastFetchAt ?? '从未'}</strong
					>{#if source.lastError}<small class="board-error">{source.lastError}</small>{/if}
				</div>
				<div class="admin-row-actions">
					<button type="button" onclick={() => refresh(source.id)}>测试刷新</button><a
						href={resolve(`/admin/hot-sources?edit=${source.id}`)}>编辑</a
					>
					<form
						method="POST"
						action="?/delete"
						onsubmit={(event) => {
							if (!confirm(`确定删除“${source.name}”及其榜单缓存吗？`)) event.preventDefault();
						}}
					>
						<input type="hidden" name="id" value={source.id} /><button type="submit">删除</button>
					</form>
				</div>
			</footer>
		</article>{/each}
</section>
{#if data.source === 'database' && !data.sources.length}<div class="admin-empty-state">
		<strong>还没有热点榜单</strong>
		<p>添加RSSHub订阅后，每个订阅会成为一个独立榜单。</p>
		<a class="admin-primary-button" href={resolve('/admin/hot-sources?create=1')}>添加第一个榜单</a>
	</div>{/if}

<style>
	.hot-admin-header span {
		color: #858a92;
		font-size: 11px;
	}
	.hot-board-editor {
		margin-bottom: 18px;
	}
	.advanced-config {
		border: 1px solid #e6e7ea;
		border-radius: 10px;
		padding: 10px 12px;
	}
	.advanced-config summary {
		cursor: pointer;
		font-size: 11px;
		font-weight: 700;
	}
	.advanced-config label {
		display: grid;
		gap: 6px;
		margin-top: 10px;
	}
	.board-switches {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		margin-top: 12px;
	}
	.hot-board-admin-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}
	.hot-board-admin-card {
		overflow: hidden;
		border: 1px solid #e2e4e7;
		border-radius: 14px;
		padding: 15px;
		background: linear-gradient(135deg, var(--surface), #fff 55%);
		box-shadow: 0 8px 28px #20242b09;
	}
	.hot-board-admin-card.disabled {
		opacity: 0.62;
	}
	.hot-board-admin-card > header {
		display: grid;
		grid-template-columns: 42px minmax(0, 1fr) auto;
		gap: 10px;
		align-items: center;
	}
	.hot-board-admin-card > header > span {
		display: grid;
		width: 40px;
		height: 40px;
		place-items: center;
		border-radius: 11px;
		color: #fff;
		background: var(--accent);
		font-weight: 850;
	}
	.hot-board-admin-card header div {
		display: grid;
		gap: 3px;
		min-width: 0;
	}
	.hot-board-admin-card header strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hot-board-admin-card header small {
		color: #8c9098;
		font-size: 9px;
	}
	.hot-board-admin-card header em {
		border-radius: 999px;
		padding: 3px 7px;
		color: var(--accent);
		background: #fff;
		font-size: 9px;
		font-style: normal;
	}
	.hot-board-admin-card > p {
		min-height: 32px;
		margin: 12px 0;
		color: #686d75;
		font-size: 11px;
		line-height: 1.55;
	}
	.board-config-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.board-config-chips span {
		border-radius: 999px;
		padding: 4px 7px;
		color: #61666e;
		background: #ffffffb8;
		font-size: 9px;
	}
	.board-url {
		margin: 10px 0;
		overflow: hidden;
		color: #888d95;
		font-family: monospace;
		font-size: 9px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hot-board-admin-card > footer {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		border-top: 1px solid #e9eaec;
		padding-top: 11px;
	}
	.hot-board-admin-card footer > div:first-child {
		display: grid;
		gap: 3px;
		color: #8a8f97;
		font-size: 9px;
	}
	.hot-board-admin-card footer strong {
		color: #53575e;
		font-size: 10px;
	}
	.board-error {
		color: #c93943 !important;
	}
	@media (max-width: 900px) {
		.hot-board-admin-grid {
			grid-template-columns: 1fr;
		}
		.hot-board-admin-card > footer {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
