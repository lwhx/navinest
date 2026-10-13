<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { scrollableTable } from '$lib/admin-actions';
	import { TASK_STATUS, taskTime, taskDuration } from '$lib/task-monitor';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let busy = $state<string | null>(null);
	let refreshError = $state('');
	let refreshing = $state(false);
	async function refresh() {
		if (refreshing || busy) return;
		refreshing = true;
		try {
			await invalidateAll();
			refreshError = '';
		} catch {
			refreshError = '刷新失败，请稍后重试。';
		} finally {
			refreshing = false;
		}
	}
	onMount(() => {
		const timer = setInterval(() => {
			if (data.tasks.some((task) => task.active && task.active.status === 'running'))
				void refresh();
		}, 5000);
		return () => clearInterval(timer);
	});
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">运行与维护</p>
		<h1>定时任务</h1>
		<p class="admin-page-description">三项每日任务 · 时间均为北京时间 · 常规记录保留 30 天</p>
	</div>
	<button class="admin-secondary-button" disabled={!!busy || refreshing} onclick={refresh}
		>{refreshing ? '刷新中…' : '刷新记录'}</button
	>
</header>
{#if form?.message}<p
		class:task-error={!form.success}
		class="task-feedback"
		role={form.success ? 'status' : 'alert'}
	>
		{form.message}
	</p>{/if}
{#if refreshError}<p class="task-feedback task-error" role="alert">{refreshError}</p>{/if}
{#if !data.available}<p class="task-feedback task-error" role="alert">
		运行记录暂时无法读取，当前不能补跑。请核对数据库和服务日志。
	</p>{/if}
<div class="task-grid">
	{#each data.tasks as task (task.id)}
		<section class="task-card" aria-labelledby={`task-${task.id}`}>
			<div class="task-card-heading">
				<h2 id={`task-${task.id}`}>{task.name}</h2>
				<span
					class="task-state"
					class:task-state-error={['failed', 'partial', 'interrupted'].includes(
						task.active?.status ?? task.latest?.status ?? ''
					)}
					>{data.available
						? task.active
							? TASK_STATUS[task.active.status]
							: task.latest
								? (TASK_STATUS[task.latest.status] ?? task.latest.status)
								: '暂无记录'
						: '待核对'}</span
				>
			</div>
			<p class="task-description">{task.description}</p>
			<dl>
				<div>
					<dt>计划</dt>
					<dd>{task.time}</dd>
				</div>
				<div>
					<dt>下次计划</dt>
					<dd>{taskTime(task.nextAt)}</dd>
				</div>
				<div>
					<dt>最近开始</dt>
					<dd>{taskTime(task.latest?.startedAt ?? null)}</dd>
				</div>
				<div>
					<dt>最近耗时</dt>
					<dd>{taskDuration(task.latest?.durationMs ?? null)}</dd>
				</div>
				<div>
					<dt>最近成功</dt>
					<dd>{taskTime(task.lastSuccessAt)}</dd>
				</div>
			</dl>
			{#if task.latest}<p class="task-result">{task.latest.summary}</p>
				{#if task.latest.error}<p class="task-inline-error">{task.latest.error}</p>{/if}{:else}<p
					class="task-result"
				>
					此页不推断部署前的执行结果。
				</p>{/if}
			<form
				method="POST"
				action="?/run"
				use:enhance={({ cancel }) => {
					if (busy || !confirm(`确认立即执行一次“${task.name}”？不会改变每日计划。`)) {
						cancel();
						return;
					}
					form = null;
					refreshError = '';
					busy = task.id;
					return async ({ update }) => {
						try {
							await invalidateAll();
							await tick();
							await update({ invalidateAll: false, reset: false });
						} catch {
							refreshError = '请求已返回，但执行记录未能刷新。请刷新核对后再操作。';
						} finally {
							busy = null;
						}
					};
				}}
			>
				<input type="hidden" name="task" value={task.id} /><input
					type="hidden"
					name="requestKey"
					value={task.requestKey}
				/>
				<button class="admin-primary-button" disabled={!data.available || !!task.active || !!busy}
					>{busy === task.id ? '执行中，请稍候…' : task.active ? '任务运行中' : '立即补跑'}</button
				>
			</form>
			{#if task.active?.status === 'interrupted'}
				<p class="task-inline-error">
					超过 30 分钟未记录完成。请先核对服务日志，确认任务已停止；解除标记不会终止原执行。
				</p>
				<form
					method="POST"
					action="?/release"
					use:enhance={({ cancel }) => {
						if (busy || !confirm('确认已核对日志且原任务已经停止？解除后才可重新补跑。')) {
							cancel();
							return;
						}
						form = null;
						refreshError = '';
						busy = `release-${task.id}`;
						return async ({ update }) => {
							try {
								await invalidateAll();
								await tick();
								await update({ invalidateAll: false, reset: false });
							} catch {
								refreshError = '请求已返回，但执行记录未能刷新。请刷新核对后再操作。';
							} finally {
								busy = null;
							}
						};
					}}
				>
					<input type="hidden" name="id" value={task.active.id} /><label class="task-confirm"
						><input
							type="checkbox"
							name="confirmed"
							value="yes"
							required
						/>已核对，确认任务停止</label
					><button class="admin-secondary-button" disabled={!!busy}>解除运行标记</button>
				</form>
			{/if}
		</section>
	{/each}
</div>
<p class="task-note">
	补跑同步等待结果，请保持页面连接。手动备份单独保存最近 14
	份，不覆盖定时快照；耗时为执行总时长，包含网络等待。运行中的任务会自动刷新记录，长时间未完成的任务不会自动解除保护。
</p>
<section class="task-history">
	<div class="task-history-heading">
		<h2>执行记录</h2>
		<form method="GET" class="admin-filter-bar">
			<label
				>任务<select name="task" value={data.filter}
					><option value="all">全部任务</option>{#each data.tasks as task (task.id)}<option
							value={task.id}>{task.name}</option
						>{/each}</select
				></label
			><button class="admin-secondary-button">筛选</button>
		</form>
	</div>
	{#if data.runs.length}
		<p class="task-note">显示当前筛选的最近 {data.runs.length} 条记录。</p>
		<div
			class="admin-table-wrap"
			use:scrollableTable
			role="region"
			aria-label="任务执行记录，可横向滚动"
		>
			<table class="admin-table">
				<thead
					><tr
						><th>任务 / 来源</th><th>状态</th><th>计划 / 开始 / 完成</th><th>耗时</th><th
							>结果与错误</th
						></tr
					></thead
				><tbody>
					{#each data.runs as run (run.id)}<tr
							><td
								><strong>{run.name}</strong><br />{run.trigger === 'manual'
									? `手动 · ${run.actor ?? '管理员'}`
									: '定时执行'}</td
							><td
								><span
									class="task-state"
									class:task-state-error={['failed', 'partial', 'interrupted'].includes(run.status)}
									>{TASK_STATUS[run.status] ?? run.status}</span
								></td
							><td
								>计划 {taskTime(run.scheduledAt)}<br />开始 {taskTime(run.startedAt)}<br />完成 {taskTime(
									run.finishedAt
								)}</td
							><td>{taskDuration(run.durationMs)}</td><td class="task-details"
								>{run.summary}{#if run.error}<p class="task-inline-error">
										{run.error}
									</p>{/if}{#if run.sources.length}<details>
										<summary>查看 {run.sources.length} 个来源结果</summary>
										<ul>
											{#each run.sources as source, index (index)}<li>{source}</li>{/each}
										</ul>
									</details>{/if}</td
							></tr
						>{/each}
				</tbody>
			</table>
		</div>
	{:else}<div class="empty-state">
			<strong>{data.available ? '暂无执行记录' : '执行记录待核对'}</strong>
			<p>
				{data.available
					? '下一次任务执行或手动补跑后，会在这里显示结果。'
					: '读取恢复后可查看历史记录。'}
			</p>
		</div>{/if}
</section>

<style>
	.task-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 16px;
	}
	.task-card {
		display: flex;
		flex-direction: column;
		min-width: 0;
		border: 1px solid var(--admin-border);
		background: var(--admin-surface);
		border-radius: 12px;
		padding: 20px;
	}
	.task-card > form:first-of-type {
		margin-top: auto;
	}
	.task-card-heading,
	.task-history-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		color: var(--admin-text);
	}
	.task-description,
	.task-note,
	dt {
		color: var(--admin-muted);
	}
	.task-description,
	.task-result,
	.task-inline-error {
		overflow-wrap: anywhere;
		line-height: 1.6;
	}
	dl {
		margin: 16px 0;
		font-size: 13px;
	}
	dl div {
		display: grid;
		grid-template-columns: 72px minmax(0, 1fr);
		gap: 8px;
		margin: 8px 0;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.task-state {
		font-size: 13px;
		font-weight: 600;
		color: var(--admin-text);
	}
	.task-state-error,
	.task-inline-error,
	.task-error {
		color: var(--admin-danger);
	}
	.task-feedback {
		padding: 12px 16px;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		background: var(--admin-surface);
	}
	.task-note {
		font-size: 13px;
		line-height: 1.7;
		margin: 16px 0;
	}
	.task-history {
		margin-top: 28px;
	}
	.task-history-heading {
		margin-bottom: 12px;
	}
	.task-details {
		min-width: 240px;
		max-width: 440px;
		white-space: normal;
		overflow-wrap: anywhere;
	}
	.task-confirm {
		display: flex;
		gap: 8px;
		align-items: center;
		min-height: 44px;
		margin: 8px 0;
	}
	.task-confirm input {
		width: 18px;
		height: 18px;
	}
	summary {
		min-height: 44px;
		cursor: pointer;
		display: flex;
		align-items: center;
	}
	@media (max-width: 1100px) {
		.task-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 620px) {
		.task-card {
			padding: 16px;
		}
		.task-history-heading {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
