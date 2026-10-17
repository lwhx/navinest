<script lang="ts">
	import { scrollableTable } from '$lib/admin-actions';
	import { resolve } from '$app/paths';
	import { invalidateAll, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { aiFailure, aiTime } from '$lib/ai-service-status';
	import AiProviderEditor from '$lib/components/admin/AiProviderEditor.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let testingId = $state<number | null>(null),
		notice = $state(''),
		failed = $state(false),
		editorDirty = $state(false),
		saving = $state(false);
	const busy = $derived(testingId !== null || saving);
	const active = $derived(data.providers.find((provider) => provider.isEnabled));
	const history = $derived(data.history);
	beforeNavigate(({ cancel }) => {
		if (testingId !== null) cancel();
	});
	async function testProvider(id: number) {
		if (busy || (data.editing?.id === id && editorDirty)) return;
		testingId = id;
		failed = false;
		notice = '正在测试已保存的服务连接与结构化输出…';
		try {
			const response = await fetch(
				resolve('/api/admin/ai-providers/[id]/test', { id: String(id) }),
				{
					method: 'POST',
					signal: AbortSignal.timeout(
						(data.providers.find((provider) => provider.id === id)?.timeoutMs ?? 30000) + 15000
					)
				}
			);
			let body;
			try {
				body = await response.json();
			} catch {
				throw new Error('测试接口返回格式异常，无法确认结果。输入已保留，请核对状态后重试。');
			}
			if (
				!body ||
				typeof body !== 'object' ||
				Array.isArray(body) ||
				(response.ok &&
					(body.success !== true ||
						typeof body.model !== 'string' ||
						!Number.isFinite(body.latencyMs)))
			)
				throw new Error('测试接口返回格式异常，无法确认结果。输入已保留。');
			failed = !response.ok;
			notice = response.ok
				? `测试通过：模型 ${body.model}，耗时 ${body.latencyMs}ms。请显式启用后使用。`
				: `${aiFailure(body.code).label}：${body.error ?? '测试未完成'} ${body.advice ?? aiFailure(body.code).advice}`;
			if (body.historySaved === false) notice += ' 本次调用记录未能保存，请稍后检查。';
			await invalidateAll();
		} catch (error) {
			failed = true;
			notice =
				error instanceof Error && error.name === 'Error'
					? error.message
					: '无法获取测试结果，输入已保留。请刷新状态后再决定是否重试。';
		} finally {
			testingId = null;
		}
	}
	function historyLink(next: number) {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('tab', 'history');
		params.set('page', String(next));
		return resolve(`/admin/ai-providers?${params}`);
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">AI Infrastructure</p>
		<h1>AI 服务</h1>
		<span>保存配置 → 测试已保存配置 → 启用服务</span>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/ai-providers?create=1')}>新增 AI 服务</a
		>{/if}
</header>
<section class="ai-current" aria-labelledby="ai-current-title">
	<h2 id="ai-current-title">当前实际使用</h2>
	{#if active}<p><strong>{active.name}</strong> · 模型 <strong>{active.model}</strong></p>
		<p class="ai-url">{active.baseUrl}</p>{:else}<p>
			<strong>未启用 AI 服务</strong>：智能读取只获取网页信息，不生成 AI 建议。
		</p>{/if}
	<p class="admin-form-hint">
		此配置用于投稿页的 AI 建议；后台内容编辑中的“网页信息读取”仅抓取网页，不调用 AI。
	</p>
</section>
{#if !data.secretConfigured}<p class="admin-notice" role="alert">
		服务器尚未配置 <code>AI_CONFIG_ENCRYPTION_KEY</code>，无法保存密钥或执行测试。
	</p>{/if}
<nav class="ai-tabs" aria-label="AI 服务管理">
	<a
		aria-current={!data.historyRequested ? 'page' : undefined}
		href={resolve('/admin/ai-providers')}>服务配置</a
	><a
		aria-current={data.historyRequested ? 'page' : undefined}
		href={resolve('/admin/ai-providers?tab=history')}>调用记录</a
	>
</nav>
{#if notice}<p class="admin-form-message" role={failed ? 'alert' : 'status'}>{notice}</p>{/if}
{#if form?.message}<p class="admin-form-message" role={form.success ? 'status' : 'alert'}>
		{form.message}
	</p>{/if}
{#if page.url.searchParams.has('created') || page.url.searchParams.has('updated')}<p
		class="admin-form-message"
		role="status"
	>
		配置已保存。请核对下方测试状态；需要重新测试的配置必须通过后再启用。
	</p>{/if}
{#if data.historyRequested && !history}<p class="admin-notice" role="alert">{data.historyError}</p>
{:else if history}
	<section aria-labelledby="history-title">
		<h2 id="history-title">调用记录</h2>
		<p>
			区分连接测试、投稿智能读取和未启用 AI
			的降级。耗时为服务端处理时间，不包含浏览器填入建议的时间；历史记录从本次升级后开始。
		</p>
		<form class="admin-form ai-filters" method="GET">
			<input type="hidden" name="tab" value="history" />
			<label
				><span>调用来源</span><select name="origin" value={history.filters.origin}
					><option value="">全部来源</option><option value="test">连接测试</option><option
						value="submission">投稿智能读取</option
					></select
				></label
			>
			<label
				><span>调用结果</span><select name="outcome" value={history.filters.outcome}
					><option value="">全部结果</option><option value="success">成功</option><option
						value="failed">失败</option
					><option value="skipped">未调用 AI</option></select
				></label
			>
			<label
				><span>服务筛选</span><select name="provider" value={history.filters.provider}
					><option value="">全部服务（含已删除）</option
					>{#each data.providers as provider (provider.id)}<option value={provider.id}
							>{provider.name}</option
						>{/each}</select
				></label
			><button class="admin-secondary-button" type="submit">筛选记录</button>
		</form>
		<p role="status">共 {history.total} 条，第 {history.page} / {history.pages} 页 · 北京时间</p>
		<div
			class="admin-table-wrap"
			use:scrollableTable
			role="region"
			aria-label="AI 调用记录，可横向滚动"
		>
			<table class="admin-table ai-history-table">
				<thead
					><tr
						><th>时间</th><th>来源 / 服务 / 模型</th><th>结果与阶段</th><th>耗时</th><th
							>原因与建议</th
						></tr
					></thead
				><tbody
					>{#each history.rows as row (row.id)}<tr
							><td data-label="时间">{aiTime(row.created_at)}</td><td
								data-label="来源 / 服务 / 模型"
								>{row.origin === 'test' ? '连接测试' : '投稿智能读取'}<small
									>{row.provider_name ?? '无服务'} · {row.model ?? '未调用模型'}</small
								></td
							><td data-label="结果与阶段"
								><strong
									>{row.outcome === 'success'
										? '成功'
										: row.outcome === 'skipped'
											? '未调用 AI'
											: '失败'}</strong
								><small
									>{row.stage === 'webpage'
										? '网页读取'
										: row.stage === 'configuration'
											? '服务配置'
											: 'AI 生成'}</small
								></td
							><td data-label="耗时"
								>总计 {row.duration_ms}ms<small
									>AI：{row.ai_duration_ms === null ? '未开始' : `${row.ai_duration_ms}ms`}</small
								></td
							><td data-label="原因与建议"
								>{#if row.error_code}<strong>{aiFailure(row.error_code).label}</strong><small
										>{aiFailure(row.error_code).advice}</small
									>{:else if row.outcome === 'skipped'}未启用服务，仅返回网页信息。{:else}{row.origin ===
									'test'
										? '连接与结构化输出验证通过，不会自动启用。'
										: '服务端已完成；页面还需要采用建议，才会填入对应内容。'}{/if}</td
							></tr
						>{:else}<tr
							><td colspan="5">暂无符合条件的记录。执行连接测试或投稿智能读取后可在这里查看。</td
							></tr
						>{/each}</tbody
				>
			</table>
		</div>
		<nav class="ai-tabs" aria-label="调用记录分页">
			{#if history.page > 1}<a href={historyLink(history.page - 1)}>上一页</a
				>{/if}{#if history.page < history.pages}<a href={historyLink(history.page + 1)}>下一页</a
				>{/if}
		</nav>
	</section>
{:else}
	{#if data.source === 'database' && data.mode && (data.mode === 'create' || data.editing)}{#key `${data.mode}:${data.editing?.id ?? ''}`}<AiProviderEditor
				editing={data.editing}
				initialValues={form && 'values' in form ? form.values : {}}
				defaultPrompt={data.defaultPrompt}
				secretConfigured={data.secretConfigured}
				testing={testingId !== null}
				onDirtyChange={(dirty) => (editorDirty = dirty)}
				onSavingChange={(value) => (saving = value)}
			/>{/key}{/if}
	<p class="admin-form-hint">
		只有测试通过的服务才能启用。测试仅针对已保存配置；测试失败将停用该服务。启用一项会原子切换并停用其他服务；不会自动启用备用服务。
	</p>
	<div
		class="admin-table-wrap"
		use:scrollableTable
		role="region"
		aria-label="管理数据列表，可横向滚动"
	>
		<table class="admin-table">
			<thead><tr><th>服务 / 模型</th><th>API 地址</th><th>状态</th><th>操作</th></tr></thead><tbody>
				{#each data.providers as provider (provider.id)}{@const dirty =
						data.editing?.id === provider.id && editorDirty}<tr
						><td
							><strong>{provider.name}</strong><small
								>{provider.model} · 密钥 ••••{provider.keyHint}</small
							></td
						><td class="ai-url">{provider.baseUrl}</td><td
							><span class="status-badge"
								>{provider.isEnabled
									? '实际使用中'
									: provider.testStatus === 'success'
										? '测试通过，未启用'
										: provider.testStatus === 'failed'
											? '测试失败，未启用'
											: '待测试，未启用'}</span
							><small
								>{dirty
									? '有未保存修改，请先保存'
									: `最近测试：${aiTime(provider.testedAt)}`}</small
							>{#if provider.testError}<small>{provider.testError}</small>{/if}</td
						><td
							><div class="admin-row-actions">
								<form
									method="POST"
									action="?/test"
									onsubmit={(event) => {
										event.preventDefault();
										testProvider(provider.id);
									}}
								>
									<input type="hidden" name="id" value={provider.id} /><button
										type="submit"
										disabled={busy || dirty || !data.secretConfigured}
										>{testingId === provider.id ? '测试中…' : '测试已保存配置'}</button
									>
								</form>
								{#if provider.isEnabled}<form method="POST" action="?/disable">
										<input type="hidden" name="id" value={provider.id} /><button
											type="submit"
											disabled={busy || dirty}>停用</button
										>
									</form>{:else}<form method="POST" action="?/enable">
										<input type="hidden" name="id" value={provider.id} /><button
											type="submit"
											disabled={busy ||
												dirty ||
												provider.testStatus !== 'success' ||
												!data.secretConfigured}>启用</button
										>
									</form>{/if}
								<a href={resolve(`/admin/ai-providers?edit=${provider.id}`)}>编辑</a>
								<form
									method="POST"
									action="?/delete"
									onsubmit={(event) => {
										if (busy || !confirm(`确定删除 AI 服务“${provider.name}”吗？`))
											event.preventDefault();
									}}
								>
									<input type="hidden" name="id" value={provider.id} /><button
										type="submit"
										disabled={busy}>删除</button
									>
								</form>
							</div></td
						></tr
					>
				{:else}<tr><td colspan="4">尚未配置 AI 服务。未配置时仍可读取网页信息和手动填写。</td></tr
					>{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.ai-current {
		margin: 0 0 20px;
		padding: 16px;
		border: 1px solid var(--admin-border, #d7dde5);
		border-radius: 12px;
		background: var(--admin-surface);
	}
	.ai-current h2 {
		font-size: 18px;
		margin: 0 0 8px;
	}
	.ai-current p {
		margin: 6px 0;
	}
	.ai-url {
		overflow-wrap: anywhere;
	}
	.ai-tabs {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		margin: 16px 0;
	}
	.ai-tabs a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 12px;
		border-radius: 8px;
	}
	.ai-tabs a[aria-current] {
		font-weight: 700;
		text-decoration: underline;
	}
	.ai-filters {
		display: flex;
		align-items: end;
		flex-wrap: wrap;
		gap: 12px;
		margin: 16px 0;
	}
	.ai-filters label {
		min-width: 160px;
		flex: 1;
	}
	.ai-filters button {
		min-height: 44px;
	}
	td small {
		display: block;
		margin-top: 6px;
		white-space: normal;
	}
	@media (max-width: 620px) {
		.ai-history-table {
			display: block;
			width: 100%;
			min-width: 0;
		}
		.ai-history-table thead {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.ai-history-table tbody {
			display: block;
		}
		.ai-history-table tr {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
			padding: 12px 16px;
			border-bottom: 1px solid var(--admin-border);
		}
		.ai-history-table td {
			display: block;
			min-width: 0;
			white-space: normal;
			overflow-wrap: anywhere;
			border: 0;
			padding: 4px 0;
		}
		.ai-history-table td[data-label]::before {
			content: attr(data-label) '：';
			display: block;
			color: var(--admin-muted);
			font-size: 13px;
			font-weight: 600;
		}

		.ai-filters label {
			min-width: 100%;
		}
	}
</style>
