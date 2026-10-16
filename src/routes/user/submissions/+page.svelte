<script lang="ts">
	import { resolve } from '$app/paths';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import {
		userSubmissionStatuses,
		submissionTypeLabels,
		userSubmissionUrl
	} from '$lib/user-submissions';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let selected = $derived(data.selected);
	let failedIcon = $state<number | null>(null);
	const label = (status: string) =>
		userSubmissionStatuses[status as keyof typeof userSubmissionStatuses] ?? '历史状态';
	const date = (value: string) =>
		new Intl.DateTimeFormat('zh-CN', {
			timeZone: 'Asia/Shanghai',
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(
			new Date(value.replace(' ', 'T') + (/([zZ]|[+-]\d{2}:\d{2})$/.test(value) ? '' : 'Z'))
		);
</script>

<svelte:head><title>我的投稿 | NaviNest 导航巢</title></svelte:head>
<AccountShell
	title="我的投稿"
	description="查看审核进度、处理意见和投稿内容，退回后可修改重投。"
	eyebrow="CONTRIBUTIONS"
>
	<section class="account-card submission-history" aria-label="投稿记录">
		<div class="account-card-header">
			<div>
				<h2>投稿记录</h2>
				<p>共 {data.total} 条匹配记录 · 第 {data.filters.page} / {data.pageCount} 页</p>
			</div>
			<a class="account-button" href={resolve('/contribute')}>新投稿</a>
		</div>
		<form class="history-filters" method="GET" action={resolve('/user/submissions')}>
			<label
				>搜索投稿<input
					type="search"
					name="q"
					value={data.filters.q}
					maxlength="160"
					placeholder="标题、正文、网址或审核意见"
				/></label
			>
			<label
				>审核状态<select name="status" value={data.filters.status}>
					{#each Object.entries(userSubmissionStatuses) as [value, text] (value)}<option {value}
							>{text}{value === 'pending' ? '（含处理中）' : ''}</option
						>{/each}
				</select></label
			>
			<button class="account-button" type="submit">筛选</button>
			<a class="account-button secondary" href={resolve('/user/submissions')}>重置</a>
		</form>
		{#if data.selectedUnavailable}<p class="history-notice" role="status">
				这条投稿不存在或不属于当前账号，请从列表重新选择。
			</p>{/if}
		{#if data.submissions.length}
			<ul class="history-list">
				{#each data.submissions as submission (submission.id)}
					<li class:active={selected?.id === submission.id}>
						<div class="record-heading">
							<h3>
								<a
									href={resolve(
										userSubmissionUrl(data.filters, { submission: submission.id }) as '/'
									)}
									aria-current={selected?.id === submission.id ? 'page' : undefined}
									>{submission.title}</a
								>
							</h3>
							<span class="history-status">{label(submission.status)}</span>
						</div>
						<p class="record-meta">
							#{submission.id} · {submissionTypeLabels[submission.type] ?? '历史类型'} ·
							<time datetime={submission.createdAt}>{date(submission.createdAt)}</time>
						</p>
						{#if submission.summary}<p class="record-summary">{submission.summary}</p>{/if}
						{#if submission.reviewMessage}<p class="record-feedback">
								<strong>审核意见：</strong>{submission.reviewMessage}
							</p>{/if}
						<div class="history-actions">
							<a
								class="account-button secondary"
								href={resolve(
									userSubmissionUrl(data.filters, { submission: submission.id }) as '/'
								)}>查看详情</a
							>
							{#if submission.publishedHref}<a
									class="account-button secondary"
									href={resolve(submission.publishedHref as '/')}>查看已发布内容</a
								>{/if}
							{#if submission.canResubmit}<a
									class="account-button"
									href={resolve(`/contribute?resubmit=${submission.id}`)}>修改后重投</a
								>{:else if submission.childId}<a
									class="account-button secondary"
									href={resolve(
										userSubmissionUrl(data.filters, { submission: submission.childId }) as '/'
									)}>查看重投记录</a
								>{/if}
						</div>
					</li>
				{/each}
			</ul>
		{:else}<div class="history-empty">
				<h3>暂无匹配投稿</h3>
				<p>
					{data.filters.q || data.filters.status !== 'all'
						? '试试其他关键词或重置筛选。'
						: '你可以推荐优质网址，或分享一篇文章。'}
				</p>
			</div>{/if}
		{#if data.pageCount > 1}<nav class="history-pagination" aria-label="投稿分页">
				{#if data.filters.page > 1}<a
						class="account-button secondary"
						href={resolve(
							userSubmissionUrl(data.filters, {
								page: data.filters.page - 1,
								submission: null
							}) as '/'
						)}>上一页</a
					>{/if}
				<span>第 {data.filters.page} / {data.pageCount} 页</span>
				{#if data.filters.page < data.pageCount}<a
						class="account-button secondary"
						href={resolve(
							userSubmissionUrl(data.filters, {
								page: data.filters.page + 1,
								submission: null
							}) as '/'
						)}>下一页</a
					>{/if}
			</nav>{/if}
	</section>
	{#if selected}<section
			class="account-card submission-detail"
			aria-label="投稿详情"
			id="submission-detail"
		>
			<div class="account-card-header">
				<div>
					<p>
						投稿 #{selected.id} · {submissionTypeLabels[selected.type] ?? '历史类型'} · {label(
							selected.status
						)}
					</p>
					<h2>{selected.title}</h2>
				</div>
				<a
					class="account-button secondary"
					href={resolve(userSubmissionUrl(data.filters, { submission: null }) as '/')}>关闭详情</a
				>
			</div>
			<div class="detail-feedback">
				<h3>审核反馈</h3>
				<p>
					{selected.reviewMessage ||
						(['pending', 'reviewing'].includes(selected.status)
							? '正在等待审核处理，暂时没有审核意见。'
							: '暂无审核意见。')}
				</p>
				<p class="record-meta">
					提交：{date(selected.createdAt)} · 更新：{date(selected.updatedAt)}（北京时间）
				</p>
			</div>
			{#if !selected.payloadAvailable}<p class="history-notice">
					这条历史投稿的内容格式已损坏，暂时无法还原。标题和审核记录仍保留。
				</p>{:else}
				<dl class="submission-fields">
					<div>
						<dt>投稿分类</dt>
						<dd>
							{selected.categoryId
								? selected.categoryPath || `原分类 #${selected.categoryId} 已不可用`
								: '未分类'}
						</dd>
					</div>
					<div>
						<dt>标签</dt>
						<dd>{selected.tagNames.join('、') || '未填写'}</dd>
					</div>
					<div>
						<dt>网址</dt>
						<dd>
							{#if selected.url}<a
									href={resolve(`/go?url=${encodeURIComponent(selected.url)}` as '/')}
									target="_blank"
									rel="external noopener noreferrer">{selected.url}</a
								>{:else}未填写{/if}
						</dd>
					</div>
					{#if selected.iconFileId}<div>
							<dt>投稿图标</dt>
							<dd>
								{#if selected.iconAvailable && failedIcon !== selected.iconFileId}<img
										src={resolve(`/api/user/files/${selected.iconFileId}` as '/')}
										alt="投稿图标"
										onerror={() => (failedIcon = selected?.iconFileId ?? null)}
										width="64"
										height="64"
									/>{:else}原图标 #{selected.iconFileId} 预览不可用{/if}
							</dd>
						</div>{/if}
					<div>
						<dt>摘要</dt>
						<dd class="submitted-text">{selected.summary || '未填写'}</dd>
					</div>
					<div>
						<dt>{selected.type === 'post' ? '正文' : '补充说明'}</dt>
						<dd class="submitted-text">{selected.content || '未填写'}</dd>
					</div>
				</dl>
			{/if}
			<div class="history-actions">
				{#if selected.parentId}<a
						class="account-button secondary"
						href={resolve(
							userSubmissionUrl(data.filters, { submission: selected.parentId }) as '/'
						)}>查看原投稿 #{selected.parentId}</a
					>{/if}
				{#if selected.childId}<a
						class="account-button secondary"
						href={resolve(userSubmissionUrl(data.filters, { submission: selected.childId }) as '/')}
						>查看重投记录 #{selected.childId}</a
					>{/if}
				{#if selected.canResubmit}<a
						class="account-button"
						href={resolve(`/contribute?resubmit=${selected.id}`)}>修改后重投</a
					>{/if}
				{#if selected.publishedHref}<a
						class="account-button"
						href={resolve(selected.publishedHref as '/')}>查看已发布内容</a
					>{/if}
			</div>
			{#if selected.status === 'rejected' && !selected.canResubmit && !selected.childId}<p
					class="record-meta"
				>
					这条记录暂不支持直接重投。历史其他类型可保留查看，新的投稿支持网址和文章。
				</p>{/if}
		</section>{/if}
</AccountShell>

<style>
	.submission-detail {
		scroll-margin-top: 90px;
	}
	.submission-history,
	.submission-detail {
		color: var(--ui-text);
		background: var(--ui-surface);
		border-color: var(--ui-line);
		overflow-wrap: anywhere;
	}
	.account-card-header {
		flex-wrap: wrap;
		align-items: center;
	}
	.account-card-header > div {
		min-width: 0;
		flex: 1 1 200px;
	}
	.account-card h2,
	.account-card h3 {
		color: var(--ui-heading);
	}
	.account-card-header p,
	.record-meta,
	.history-empty p {
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.7;
	}
	.account-button {
		min-height: 44px;
		font-size: 13px;
		background: var(--ui-accent);
		color: var(--ui-on-accent);
		text-align: center;
	}
	.account-button.secondary {
		background: var(--ui-soft);
		color: var(--ui-text);
		border: 1px solid var(--ui-line);
	}
	.history-filters {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 12px;
		margin-bottom: 20px;
	}
	.history-filters label {
		display: grid;
		gap: 8px;
		font-size: 13px;
		flex: 1 1 190px;
		min-width: 0;
	}
	.history-filters input,
	.history-filters select {
		width: 100%;
		min-width: 0;
		min-height: 44px;
		padding: 10px;
		border: 1px solid var(--ui-line);
		border-radius: 8px;
		background: var(--ui-soft);
		color: var(--ui-text);
		font: inherit;
	}
	.history-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}
	.history-list li {
		min-width: 0;
		padding: 16px;
		border: 1px solid var(--ui-line);
		border-radius: 12px;
		background: var(--ui-soft);
	}
	.history-list li.active {
		border-color: var(--ui-accent);
	}
	.record-heading {
		display: flex;
		gap: 12px;
		justify-content: space-between;
		align-items: start;
	}
	.record-heading h3 {
		font-size: 16px;
		min-width: 0;
		margin: 0;
		line-height: 1.6;
	}
	.record-heading h3 a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--ui-heading);
	}
	.history-status {
		flex: none;
		display: inline-block;
		padding: 6px 9px;
		border-radius: 8px;
		background: var(--ui-surface);
		font-size: 13px;
		white-space: nowrap;
	}
	.record-summary,
	.record-feedback {
		font-size: 15px;
		line-height: 1.8;
		margin: 10px 0;
	}
	.record-summary {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.record-feedback {
		white-space: pre-wrap;
	}
	.history-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 12px;
	}
	.history-pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		flex-wrap: wrap;
		margin-top: 20px;
		font-size: 13px;
	}
	.history-notice,
	.detail-feedback {
		padding: 16px;
		border: 1px solid var(--ui-line);
		border-radius: 10px;
		background: var(--ui-soft);
		font-size: 15px;
		line-height: 1.8;
	}
	.history-notice,
	.detail-feedback p:not(.record-meta) {
		white-space: pre-wrap;
	}
	.detail-feedback h3 {
		font-size: 16px;
	}
	.detail-feedback p {
		margin: 8px 0;
	}
	.history-empty {
		padding: 24px 0;
	}
	.history-empty h3 {
		font-size: 16px;
	}
	.submission-fields {
		display: grid;
		gap: 20px;
		margin: 24px 0;
	}
	.submission-fields > div {
		min-width: 0;
	}
	.submission-fields dt {
		font-size: 13px;
		color: var(--ui-muted);
		margin-bottom: 8px;
	}
	.submission-fields dd {
		margin: 0;
		font-size: 15px;
		line-height: 1.8;
	}
	.submission-fields a {
		color: var(--ui-accent);
		text-decoration: underline;
	}
	.submission-fields img {
		object-fit: contain;
		border: 1px solid var(--ui-line);
		border-radius: 8px;
	}
	.submitted-text {
		white-space: pre-wrap;
	}
	@media (max-width: 480px) {
		.history-list li {
			padding: 12px;
		}
		.record-heading {
			gap: 8px;
		}
		.history-actions .account-button {
			flex: 1 1 120px;
		}
	}
</style>
