<script lang="ts">
	import { scrollableTable } from '$lib/admin-actions';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const labels: Record<string, string> = {
		success: '成功',
		partial: '部分失败',
		failed: '失败',
		running: '运行中'
	};
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Cron Health</p>
		<h1>定时任务</h1>
		<p>{data.timezone}（UTC 01:15）· <code>{data.cron}</code></p>
	</div>
</header>
{#if data.runs.length}<div
		class="admin-table-wrap"
		use:scrollableTable
		role="region"
		aria-label="管理数据列表，可横向滚动"
	>
		<table class="admin-table">
			<thead
				><tr><th>计划时间</th><th>状态</th><th>开始 / 完成</th><th>来源结果</th><th>错误</th></tr
				></thead
			><tbody
				>{#each data.runs as run (run.id)}<tr
						><td>{run.scheduledAt}</td><td><strong>{labels[run.status] ?? run.status}</strong></td
						><td>{run.startedAt}<br />{run.finishedAt ?? '—'}</td><td
							>总计 {run.totalSources} · 成功 {run.succeededSources} · 失败 {run.failedSources}{#if run.results.length}<ul
								>
									{#each run.results as result (result.sourceId)}<li>
											来源 {result.sourceId}：{result.ok
												? `成功 ${result.count} 条`
												: `失败 ${result.error}`}
										</li>{/each}
								</ul>{/if}</td
						><td>{run.errorMessage ?? '—'}</td></tr
					>{/each}</tbody
			>
		</table>
	</div>{:else}<div class="empty-state">
		<strong>暂无应用内运行记录</strong>
		<p>
			监控功能部署后的下一次北京时间09:15定时任务会在这里留下结果。更早的事件可在 Cloudflare Cron
			Events 中查看。
		</p>
	</div>{/if}
