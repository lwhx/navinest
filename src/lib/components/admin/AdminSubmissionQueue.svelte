<script lang="ts">
	import { resolve } from '$app/paths';
	import { submissionQueueUrl, type SubmissionQueueFilters } from '$lib/submission-queue';

	type QueueSubmission = {
		id: number;
		type: string;
		title: string;
		status: string;
		processing: boolean;
		createdAt: string;
		user: { displayName: string };
		payload: { aiSuggestion?: unknown };
	};

	let {
		submissions,
		selectedId,
		filters,
		total,
		pageCount,
		pageSize,
		busy,
		typeLabels,
		statusLabel,
		blockBusy
	}: {
		submissions: QueueSubmission[];
		selectedId: number | null;
		filters: SubmissionQueueFilters;
		total: number;
		pageCount: number;
		pageSize: number;
		busy: boolean;
		typeLabels: Record<string, string>;
		statusLabel: (status: string) => string;
		blockBusy: (event: MouseEvent) => void;
	} = $props();
</script>

<aside class="review-queue">
	<div class="review-queue-head"><strong>审核队列</strong><span>{total} 条</span></div>
	<form
		class="review-filters"
		method="GET"
		action={resolve('/admin/submissions')}
		onsubmit={(event) => {
			if (busy) event.preventDefault();
		}}
	>
		<label
			><span>搜索投稿</span><input
				name="q"
				value={filters.q}
				maxlength="160"
				placeholder="标题、投稿人或网址"
				disabled={busy}
			/></label
		>
		<label
			><span>审核状态</span><select name="status" value={filters.status} disabled={busy}
				><option value="pending">待处理</option><option value="reviewing">处理中</option><option
					value="published">已发布</option
				><option value="approved">历史已通过</option><option value="rejected">已拒绝</option><option
					value="all">全部</option
				></select
			></label
		>
		<button class="admin-secondary-button" type="submit" disabled={busy}>筛选</button>
	</form>
	<div class="review-list">
		{#each submissions as submission (submission.id)}<a
				href={resolve(
					submissionQueueUrl(filters, { submission: submission.id }) as '/admin/submissions'
				)}
				class:active={selectedId === submission.id}
				aria-current={selectedId === submission.id ? 'true' : undefined}
				aria-disabled={busy}
				onclick={blockBusy}
				><span class="review-type"
					>{typeLabels[submission.type] ?? '投稿'} · {submission.processing
						? '处理中'
						: statusLabel(submission.status)}</span
				><strong>{submission.title}</strong><small
					>{submission.user.displayName} · {submission.createdAt.slice(0, 10)}</small
				>{#if submission.payload.aiSuggestion}<em>✦ AI</em>{/if}</a
			>{:else}<p class="admin-notice">没有匹配投稿。</p>{/each}
	</div>
	<nav class="review-pagination" aria-label="投稿分页">
		<p>第 {filters.page} / {pageCount} 页 · 每页 {pageSize} 条</p>
		<div>
			{#if filters.page > 1}<a
					href={resolve(
						submissionQueueUrl(filters, {
							page: filters.page - 1,
							submission: null
						}) as '/admin/submissions'
					)}
					onclick={blockBusy}>上一页</a
				>{/if}{#if filters.page < pageCount}<a
					href={resolve(
						submissionQueueUrl(filters, {
							page: filters.page + 1,
							submission: null
						}) as '/admin/submissions'
					)}
					onclick={blockBusy}>下一页</a
				>{/if}
		</div>
	</nav>
</aside>

<style>
	.review-queue {
		border: 1px solid var(--admin-border);
		border-radius: 14px;
		background: var(--admin-surface);
		box-shadow: 0 8px 28px #20242b0a;
		position: sticky;
		top: 80px;
		overflow: hidden;
	}
	.review-queue-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 18px;
		border-bottom: 1px solid var(--admin-border);
	}
	.review-queue-head span {
		border-radius: 999px;
		padding: 3px 8px;
		background: var(--admin-soft);
		font-size: 13px;
	}
	.review-filters {
		display: grid;
		gap: 8px;
		padding: 12px;
		border-bottom: 1px solid var(--admin-border);
	}
	.review-filters label {
		display: grid;
		gap: 5px;
		font-size: 13px;
	}
	.review-filters input,
	.review-filters select {
		min-height: 44px;
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		padding: 0 10px;
		font: inherit;
	}
	.review-list {
		display: grid;
		max-height: calc(100vh - 250px);
		overflow: auto;
	}
	.review-list a {
		text-decoration: none;
		color: inherit;
		overflow-wrap: anywhere;
		position: relative;
		display: grid;
		gap: 5px;
		border: 0;
		border-bottom: 1px solid var(--admin-border);
		padding: 13px 15px;
		background: var(--admin-surface);
		text-align: left;
		cursor: pointer;
	}
	.review-list a:focus-visible {
		outline: 2px solid var(--admin-accent);
		outline-offset: -2px;
	}
	.review-list a[aria-disabled='true'] {
		cursor: wait;
	}
	.review-list a:hover,
	.review-list a.active {
		background: var(--admin-soft);
	}
	.review-list a.active {
		box-shadow: inset 3px 0 var(--admin-accent);
	}
	.review-list strong {
		font-size: 15px;
		padding-right: 40px;
	}
	.review-list small {
		color: var(--admin-muted);
		font-size: 13px;
	}
	.review-list em {
		position: absolute;
		top: 13px;
		right: 12px;
		color: var(--admin-accent);
		font-size: 13px;
		font-style: normal;
	}
	.review-type {
		color: var(--admin-muted);
		font-size: 13px;
		text-transform: uppercase;
	}
	.review-pagination {
		padding: 12px;
		display: grid;
		gap: 8px;
		border-top: 1px solid var(--admin-border);
	}
	.review-pagination p {
		font-size: 13px;
		color: var(--admin-muted);
		margin: 0;
	}
	.review-pagination div {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}
	.review-pagination a {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		color: var(--admin-accent);
	}
	@media (max-width: 1000px) {
		.review-queue {
			position: static;
		}
		.review-list {
			max-height: 320px;
		}
	}
</style>
