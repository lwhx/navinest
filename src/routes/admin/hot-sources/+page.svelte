<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll, beforeNavigate } from '$app/navigation';
	import { tick, onMount } from 'svelte';
	import { hotHealth, hotDate, hotErrorDetail, HOT_REMINDER_DAYS } from '$lib/hot-health';
	import type { inspectHotSource } from '$lib/server/services/hotnews';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	type Preview = Awaited<ReturnType<typeof inspectHotSource>>;
	let draft = $state<Record<string, string>>({});
	$effect(() => {
		const values = (form && 'values' in form ? form.values : {}) as Record<string, unknown>;
		draft = {
			...Object.fromEntries(
				Object.entries(values).filter(([, value]) => typeof value === 'string')
			),
			_editor: `${data.mode}:${data.editing?.id ?? ''}`
		};
	});
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	let notice = $state(''),
		refreshingId = $state<number | null>(null),
		checking = $state(false),
		preview = $state<Preview | null>(null),
		previewName = $state(''),
		previewInvalid = $state(false),
		editorForm = $state<HTMLFormElement | null>(null),
		previewHeading = $state<HTMLHeadingElement | null>(null),
		query = $state(''),
		page = $state(1),
		localErrors = $state<Record<string, string>>({});
	const busy = $derived(checking || refreshingId !== null);
	const errors = $derived({
		...((form && 'errors' in form ? form.errors : {}) as Record<string, string>),
		...localErrors
	});
	const result = $derived(
		previewInvalid ? null : (preview ?? (form && 'preview' in form ? form.preview : null))
	);
	const filtered = $derived(
		(result?.items ?? []).filter((item) =>
			(item.title + ' ' + item.url).toLowerCase().includes(query.toLowerCase())
		)
	);
	const pages = $derived(Math.max(1, Math.ceil(filtered.length / 20)));
	beforeNavigate(({ cancel }) => {
		if (busy) cancel();
	});
	function val(name: string, fallback: string | number = '') {
		if (Object.hasOwn(draft, name)) return draft[name];
		const values = (form && 'values' in form ? form.values : {}) as Record<string, unknown>;
		return typeof values[name] === 'string' ? (values[name] as string) : String(fallback ?? '');
	}
	function changed(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.name)
			draft = {
				...draft,
				[target.name]: target.type === 'checkbox' ? (target.checked ? 'on' : '') : target.value
			};
		if (['type', 'url', 'headersJson', 'parserJson'].includes(target.name)) {
			preview = null;
			previewInvalid = true;
			localErrors = {};
		}
	}
	async function check(values: Record<string, unknown>, name = '当前配置') {
		if (busy) return;
		checking = true;
		notice = '';
		localErrors = {};
		preview = null;
		previewInvalid = true;
		try {
			const response = await fetch('/api/admin/hot-sources/preview', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(values),
					signal: AbortSignal.timeout(25000)
				}),
				body = await response.json();
			if (!response.ok) {
				localErrors = body.fields ?? {};
				throw new Error([body.error, body.tip].filter(Boolean).join(' ') || '检查未完成，请重试。');
			}
			preview = body.preview;
			previewName = name;
			previewInvalid = false;
			query = '';
			page = 1;
			await tick();
			previewHeading?.focus();
		} catch (error) {
			notice =
				error instanceof Error &&
				!['TypeError', 'SyntaxError', 'AbortError', 'TimeoutError'].includes(error.name)
					? error.message
					: '检查未完成，请检查网络后重试；填写内容已保留。';
		} finally {
			checking = false;
		}
	}
	async function refresh(id: number) {
		if (busy) return;
		refreshingId = id;
		notice = '正在刷新缓存…';
		try {
			const response = await fetch(`/api/admin/hot-sources/${id}/refresh`, {
				method: 'POST',
				signal: AbortSignal.timeout(30000)
			});
			let body: { count?: number; error?: string; tip?: string; warning?: string } = {};
			try {
				body = await response.json();
			} catch {
				/* A gateway may return HTML. */
			}
			notice = response.ok
				? `刷新成功，共获取 ${body.count ?? 0} 条。${body.warning ?? ''}`
				: [body.error || '刷新失败，请稍后重试。', body.tip].filter(Boolean).join(' ');
			try {
				await invalidateAll();
			} catch {
				notice += ' 列表读取失败，请稍后刷新核对。';
			}
		} catch {
			notice = '刷新结果待核对，请刷新页面查看状态；已有缓存继续保留。';
		} finally {
			refreshingId = null;
		}
	}
</script>

<header class="admin-page-header hot-admin-header">
	<div>
		<p class="eyebrow">RSS Hot Boards</p>
		<h1>热点榜单</h1>
		<span>检查 RSS、Atom、JSON 或 HTML 解析结果，再维护榜单与缓存。</span>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/hot-sources?create=1')}>添加榜单</a
		>{/if}
</header>
{#if notice}<p class="admin-form-message" role="status">{notice}</p>{/if}
{#if form?.message}<p class="admin-form-message" role="status">{form.message}</p>{/if}
<section class="hot-health-summary" aria-label="榜单健康概览">
	{#each [['healthy', '更新正常'], ['failed', '刷新失败'], ['stale', '内容过期'], ['waiting', '尚未验证']] as [key, label] (key)}<div
		>
			<span>{label}</span><strong
				>{data.sources.filter((source) => hotHealth(source).kind === key).length}</strong
			>
		</div>{/each}
</section>
<p class="hot-health-note">
	同一异常每 {HOT_REMINDER_DAYS} 天汇总一次，状态变化与恢复即时提醒。{#if data.alertUnavailable}告警记录读取失败，请稍后核对。{:else if data.alertSummary}最近核对：{hotDate(
			data.alertSummary.lastSeen
		)} · 已观察 {data.alertSummary.observations} 次{data.alertSummary.webhook === 'failed'
			? ' · 站外推送未确认成功'
			: data.alertSummary.webhook === 'pending'
				? ' · 站外推送结果待核对'
				: ''}{/if}
</p>
{#if result}<section class="admin-editor hot-preview" aria-label="解析预览">
		<div class="admin-editor-header">
			<div>
				<p class="eyebrow">PREVIEW</p>
				<h2 tabindex="-1" bind:this={previewHeading}>
					解析预览 · {previewName || val('name', '当前配置')}
				</h2>
			</div>
		</div>
		<div class="hot-preview-body">
			<p>
				共解析 {result.count} 条 · {result.contentType} · 耗时 {result.latencyMs} 毫秒 · {hotDate(
					result.checkedAt
				)}
			</p>
			<p class="hot-health-note">本次仅检查解析，配置和缓存尚未改动。最多读取前 100 个有效条目。</p>
			{#if mounted}<label
					>搜索预览条目<input
						type="search"
						bind:value={query}
						oninput={() => {
							page = 1;
						}}
						placeholder="标题或链接"
					/></label
				>{/if}
			{#if mounted}<p>
					匹配 {filtered.length} 条 · 第 {Math.min(page, pages)} / {pages} 页
				</p>{:else}<p>显示全部 {result.count} 条</p>{/if}
			<ol start={(Math.min(page, pages) - 1) * 20 + 1}>
				{#each mounted ? filtered.slice((Math.min(page, pages) - 1) * 20, Math.min(page, pages) * 20) : result.items as item (item.rank)}<li
					>
						<a
							href={resolve(`/go?url=${encodeURIComponent(item.url)}` as '/go')}
							target="_blank"
							rel="noopener noreferrer">{item.title}</a
						><small>{item.url}</small>{#if item.hotValue}<span>{item.hotValue}</span>{/if}
					</li>{:else}<li>暂无匹配条目。</li>{/each}
			</ol>
			{#if mounted && pages > 1}<nav aria-label="解析预览分页">
					<button
						class="admin-secondary-button"
						disabled={page <= 1 || busy}
						onclick={() => {
							page -= 1;
						}}>上一页</button
					><span>第 {Math.min(page, pages)} / {pages} 页</span><button
						class="admin-secondary-button"
						disabled={page >= pages || busy}
						onclick={() => {
							page += 1;
						}}>下一页</button
					>
				</nav>{/if}
		</div>
	</section>{/if}
{#if data.source === 'fallback'}<p class="admin-notice">数据库不可用。</p>{/if}

{#if data.source === 'database' && data.mode}<section class="admin-editor hot-board-editor">
		<div class="admin-editor-header">
			<div>
				<p class="eyebrow">BOARD DESIGN</p>
				<h2>{data.mode === 'create' ? '添加热点榜单' : `编辑：${data.editing?.name}`}</h2>
			</div>
			<a
				href={resolve('/admin/hot-sources')}
				aria-label="关闭编辑器"
				aria-disabled={busy}
				onclick={(event) => {
					if (busy) event.preventDefault();
				}}>×</a
			>
		</div>
		{#if data.mode === 'create' || data.editing}<form
				bind:this={editorForm}
				oninput={changed}
				onchange={changed}
				class="admin-form"
				method="POST"
				action={data.mode === 'create' ? '?create=1&/create' : `?edit=${data.editing?.id}&/update`}
			>
				{#if data.editing}<input type="hidden" name="id" value={data.editing.id} />{/if}
				{#if data.editing?.configInvalid}<p class="admin-form-message" role="alert">
						原请求头或解析 JSON 已损坏，请修正后检查。
					</p>{/if}
				<fieldset class="admin-form-section" disabled={busy}>
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
				<fieldset class="admin-form-section" disabled={busy}>
					<legend>订阅与解析</legend>
					<div class="admin-form-grid">
						<label
							><span>订阅类型</span><select name="type"
								><option value="rss" selected={val('type', data.editing?.type ?? 'rss') === 'rss'}
									>RSSHub / RSS / Atom</option
								><option value="json" selected={val('type', data.editing?.type) === 'json'}
									>自定义 JSON API</option
								><option value="html" selected={val('type', data.editing?.type) === 'html'}
									>HTML 页面抓取</option
								></select
							></label
						>
						<label
							><span>自动刷新最小间隔（秒）</span><input
								name="cacheTtl"
								type="number"
								min="60"
								max="86400"
								value={val('cacheTtl', data.editing?.cacheTtl ?? 900)}
							/>{#if errors.cacheTtl}<small class="field-error">{errors.cacheTtl}</small
								>{/if}</label
						>
						<label class="admin-field-wide"
							><span>RSSHub / RSS / API / 页面 公网URL</span><input
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
							<summary>高级请求与解析配置</summary><label
								><span>请求头JSON（禁止凭据）</span><textarea name="headersJson"
									>{val('headersJson', data.editing?.headersJson ?? '{}')}</textarea
								>{#if errors.headersJson}<small class="field-error">{errors.headersJson}</small
									>{/if}</label
							><label
								><span>解析配置（JSON / HTML）</span><textarea name="parserJson"
									>{val('parserJson', data.editing?.parserJson ?? '{}')}</textarea
								>{#if errors.parserJson}<small class="field-error">{errors.parserJson}</small
									>{/if}<small
									>JSON：itemsPath / titleField / urlField / hotField；HTML：itemSelector（必填，如
									li.hot-item）/ titleSelector / hotSelector / baseUrl。</small
								></label
							>
						</details>
					</div>
				</fieldset>
				<fieldset class="admin-form-section" disabled={busy}>
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
								checked={val(
									'showDescription',
									form && 'values' in form ? '' : data.editing?.showDescription ? 'on' : ''
								) === 'on'}
							/><span>显示RSS摘要</span></label
						><label class="admin-checkbox"
							><input
								name="isEnabled"
								type="checkbox"
								checked={val(
									'isEnabled',
									form && 'values' in form ? '' : data.editing?.isEnabled !== false ? 'on' : ''
								) === 'on'}
							/><span>启用榜单</span></label
						>
					</div>
				</fieldset>
				<div class="admin-form-actions">
					<button
						class="admin-secondary-button"
						type="submit"
						formaction={data.mode === 'create'
							? '?create=1&/preview'
							: `?edit=${data.editing?.id}&/preview`}
						formnovalidate
						disabled={busy}
						onclick={(event) => {
							event.preventDefault();
							if (editorForm)
								void check(
									Object.fromEntries(new FormData(editorForm)),
									String(new FormData(editorForm).get('name') || '当前配置')
								);
						}}>{checking ? '检查中…' : '检查解析'}</button
					><button class="admin-primary-button" type="submit" disabled={busy}>保存榜单</button><a
						class="admin-secondary-button"
						href={resolve('/admin/hot-sources')}>取消</a
					>
				</div>
			</form>{/if}
	</section>{/if}

<section class="hot-board-admin-grid" aria-label="热点榜单列表">
	{#each data.sources as source, index (source.id)}<article
			class:disabled={!source.isEnabled}
			class="hot-board-admin-card"
			style={`--accent:${source.accentColor};--surface:${source.surfaceColor}`}
		>
			<header>
				<span>{source.icon}</span>
				<div>
					<strong>{source.name}</strong><small
						>{source.type === 'rss'
							? 'RSSHUB / RSS / ATOM'
							: source.type === 'html'
								? 'HTML 页面'
								: 'JSON API'} · 排序 {source.sortOrder}</small
					>
				</div>
				<em>{source.isEnabled ? '启用' : '停用'}</em>
			</header>
			<p>{source.description || '未填写榜单说明'}</p>
			<div class="board-config-chips">
				<span>{source.layout}</span><span>{source.displayLimit}条</span><span
					>{source.cacheTtl}秒刷新间隔</span
				><span>{source.showDescription ? '显示摘要' : '隐藏摘要'}</span>
			</div>
			<div class="board-url">{source.url}</div>
			<footer>
				<div class="hot-source-health">
					<strong class={`hot-health-state state-${hotHealth(source).kind}`}
						>{hotHealth(source).label}</strong
					>
					<p>{hotHealth(source).detail}</p>
					<small>最后尝试：{hotDate(source.lastFetchAt)}</small><small
						>最后成功：{hotDate(source.lastSuccessAt)}</small
					><small>现有缓存：{source.itemCount} 条</small>{#if source.lastError}<p
							class="board-error"
						>
							<strong>{hotErrorDetail(source.lastError).label}</strong> · {source.lastError}
						</p>
						<p class="hot-health-note">
							{hotErrorDetail(source.lastError).tip}
						</p>{/if}{#if source.configInvalid}<p class="board-error">
							请求头或解析 JSON 无效，请编辑修正。
						</p>{/if}
				</div>
				<div class="admin-row-actions">
					<form method="POST" action="?/move" class="board-order-actions">
						<input type="hidden" name="id" value={source.id} />
						<button
							type="submit"
							name="direction"
							value="up"
							disabled={index === 0 || busy || Boolean(data.mode)}
							title="上移榜单"
							aria-label={`上移${source.name}`}>↑</button
						><button
							type="submit"
							name="direction"
							value="down"
							disabled={index === data.sources.length - 1 || busy || Boolean(data.mode)}
							title="下移榜单"
							aria-label={`下移${source.name}`}>↓</button
						>
					</form>
					<form
						method="POST"
						action="?/preview"
						onsubmit={(event) => {
							event.preventDefault();
							void check(
								{
									type: source.type,
									url: source.url,
									headersJson: source.headersJson,
									parserJson: source.parserJson
								},
								source.name
							);
						}}
					>
						{#each Object.entries( { name: source.name, type: source.type, url: source.url, headersJson: source.headersJson, parserJson: source.parserJson } ) as [key, value] (key)}<input
								type="hidden"
								name={key}
								{value}
							/>{/each}<button type="submit" disabled={busy || Boolean(data.mode)}
							>{checking ? '检查中…' : '检查解析'}</button
						>
					</form>
					<form
						method="POST"
						action="?/refresh"
						onsubmit={(event) => {
							event.preventDefault();
							void refresh(source.id);
						}}
					>
						<input type="hidden" name="id" value={source.id} /><button
							type="submit"
							disabled={busy || Boolean(data.mode)}
							>{refreshingId === source.id ? '刷新中…' : '刷新缓存'}</button
						>
					</form>
					<a href={resolve(`/admin/hot-sources?edit=${source.id}`)}>编辑</a>
					<details class="hot-delete">
						<summary>删除榜单</summary>
						<form method="POST" action="?/delete">
							<input type="hidden" name="id" value={source.id} /><label
								><input type="checkbox" name="confirmed" value="yes" required /><span
									>确认删除“{source.name}”及全部缓存</span
								></label
							><button type="submit" disabled={busy || Boolean(data.mode)}>确认删除</button>
						</form>
					</details>
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
	.hot-health-summary {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
		margin: 20px 0;
	}
	.hot-health-summary > div {
		display: grid;
		gap: 8px;
		border: 1px solid var(--admin-border);
		border-radius: 10px;
		padding: 16px;
		background: var(--admin-surface);
		color: var(--admin-muted);
	}
	.hot-health-summary strong {
		font-size: 24px;
		color: var(--admin-text);
	}
	.hot-health-note {
		font-size: 0.875rem;
		color: var(--admin-muted);
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.hot-source-health {
		min-width: 0;
	}
	.hot-source-health small {
		display: block;
		line-height: 1.8;
	}
	.hot-source-health p {
		margin: 8px 0 !important;
		overflow-wrap: anywhere;
	}
	.hot-health-state {
		display: inline-flex;
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		padding: 4px 8px;
	}
	.state-failed,
	.state-stale {
		color: var(--admin-danger);
	}
	.state-healthy {
		color: var(--admin-success);
	}
	.hot-preview {
		margin-bottom: 24px;
		scroll-margin-top: 90px;
	}
	.hot-preview h2 {
		overflow-wrap: anywhere;
	}
	.hot-preview-body {
		padding: 20px;
		overflow-wrap: anywhere;
	}
	.hot-preview-body label {
		display: grid;
		gap: 8px;
	}
	.hot-preview-body input {
		min-height: 44px;
		border: 1px solid var(--admin-input-border);
		background: var(--admin-surface);
		color: var(--admin-text);
		padding: 10px;
		border-radius: 8px;
	}
	.hot-preview-body ol {
		padding-left: 24px;
	}
	.hot-preview-body li {
		padding: 10px 0;
		border-bottom: 1px solid var(--admin-border);
	}
	.hot-preview-body li a {
		display: block;
		min-height: 44px;
		align-content: center;
		color: var(--admin-text);
	}
	.hot-preview-body li small {
		display: block;
		color: var(--admin-muted);
		overflow-wrap: anywhere;
	}
	.hot-preview-body nav {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: center;
		justify-content: center;
	}
	.hot-delete summary {
		min-height: 44px;
		align-content: center;
		cursor: pointer;
		padding: 8px;
		border: 1px solid var(--admin-border);
		border-radius: 6px;
	}
	.hot-delete label {
		display: flex;
		gap: 8px;
		align-items: start;
		max-width: 220px;
		padding: 12px 0;
		overflow-wrap: anywhere;
	}
	.hot-delete input {
		margin-top: 5px;
	}
	.hot-board-admin-card footer {
		flex-wrap: wrap;
	}
	.hot-board-admin-card .admin-row-actions {
		flex-wrap: wrap;
		align-items: center;
	}
	.hot-board-admin-card .admin-row-actions button,
	.hot-board-admin-card .admin-row-actions a {
		min-height: 44px;
	}
	.hot-board-admin-card .admin-row-actions a {
		align-content: center;
	}
	@media (max-width: 600px) {
		.hot-health-summary {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.hot-preview-body {
			padding: 16px;
		}
	}

	.hot-admin-header span {
		color: var(--admin-muted);
		font-size: 14px;
	}
	.hot-board-editor {
		margin-bottom: 18px;
	}
	.advanced-config {
		border: 1px solid var(--admin-border);
		border-radius: 10px;
		padding: 10px 12px;
	}
	.advanced-config summary {
		cursor: pointer;
		font-size: 14px;
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
		border: 1px solid var(--admin-border);
		border-top: 3px solid var(--accent);
		border-radius: 14px;
		padding: 15px;
		background: var(--admin-surface);
		color: var(--admin-text);
		box-shadow: 0 8px 28px #20242b09;
	}
	.hot-board-admin-card.disabled {
		border-style: dashed;
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
		color: var(--admin-muted);
		font-size: 12px;
	}
	.hot-board-admin-card header em {
		border-radius: 999px;
		padding: 3px 7px;
		color: var(--admin-text);
		background: var(--admin-soft);
		font-size: 12px;
		font-style: normal;
	}
	.hot-board-admin-card > p {
		min-height: 32px;
		margin: 12px 0;
		color: var(--admin-muted);
		font-size: 14px;
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
		color: var(--admin-muted);
		background: var(--admin-soft);
		font-size: 12px;
	}
	.board-url {
		margin: 10px 0;
		overflow: hidden;
		color: var(--admin-muted);
		font-family: monospace;
		font-size: 12px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hot-board-admin-card > footer {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		border-top: 1px solid var(--admin-border);
		padding-top: 11px;
	}
	.hot-board-admin-card footer > div:first-child {
		display: grid;
		gap: 3px;
		color: var(--admin-muted);
		font-size: 12px;
	}
	.hot-board-admin-card footer strong {
		color: var(--admin-text);
		font-size: 14px;
	}
	.board-error {
		color: var(--admin-danger) !important;
	}
	.board-order-actions {
		display: flex;
		gap: 4px;
	}
	.board-order-actions button {
		width: 44px;
		padding-inline: 0;
	}
	.board-order-actions button:disabled {
		cursor: not-allowed;
		opacity: 0.38;
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
