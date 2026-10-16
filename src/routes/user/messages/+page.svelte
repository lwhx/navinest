<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import { messageDate, messageTypeLabels, messageUrl } from '$lib/messages';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let busy = $state<number | null>(null),
		notice = $state('');
	function itemPath(item: { type: string; slug: string }) {
		const prefixes: Record<string, string> = {
			site: 'sites',
			post: 'posts',
			app: 'apps',
			book: 'books',
			bulletin: 'bulletins'
		};
		return `/${prefixes[item.type]}/${encodeURIComponent(item.slug)}`;
	}
	async function read(event: SubmitEvent, id: number) {
		event.preventDefault();
		if (busy !== null) return;
		busy = id;
		notice = '';
		try {
			const response = await fetch(`/api/user/messages/${id}/read`, {
				method: 'PATCH',
				signal: AbortSignal.timeout(15000)
			});
			if (!response.ok) {
				const body = await response.json();
				throw new Error(body.error || '标记失败。');
			}
			await invalidateAll();
			notice = '已标记为已读。';
		} catch (error) {
			notice =
				error instanceof Error &&
				!['TypeError', 'SyntaxError', 'AbortError', 'TimeoutError'].includes(error.name)
					? error.message
					: '结果待核对，可刷新或重试；重复标记不会产生额外操作。';
		} finally {
			busy = null;
		}
	}
</script>

<svelte:head><title>站内消息 | NaviNest 导航巢</title></svelte:head>
<AccountShell
	title="站内消息"
	description="查看投稿审核与站点通知，时间统一为北京时间。"
	eyebrow="INBOX"
>
	<section class="account-card inbox" aria-label="消息列表">
		<div class="account-card-header">
			<div>
				<h2>消息列表</h2>
				<p>共 {data.allTotal} 条 · 未读 {data.unread} 条</p>
			</div>
			<a class="account-button secondary" href={resolve('/user/submissions')}>我的投稿</a>
		</div>
		{#if notice || form?.message}<p class="inbox-notice" role="status">
				{notice || form?.message}
			</p>{/if}
		<form class="inbox-filters" method="GET" action={resolve('/user/messages')}>
			<label
				>搜索消息<input
					type="search"
					name="q"
					value={data.filters.q}
					maxlength="160"
					placeholder="标题或正文"
				/></label
			><label
				>阅读状态<select name="status" value={data.filters.status}
					><option value="all">全部消息</option><option value="unread">未读</option><option
						value="read">已读</option
					></select
				></label
			><label
				>消息类型<select name="type" value={data.filters.type}
					><option value="all">全部类型</option
					>{#each Object.entries(messageTypeLabels) as [value, text] (value)}<option {value}
							>{text}</option
						>{/each}</select
				></label
			><button class="account-button">筛选</button><a
				class="account-button secondary"
				href={resolve('/user/messages')}>重置</a
			>
		</form>
		<p class="inbox-meta">
			共 {data.total} 条匹配消息 · 第 {data.filters.page} / {data.pageCount} 页 · 每页 20 条
		</p>
		{#if data.messages.length}<ul class="inbox-list">
				{#each data.messages as message (message.id)}<li class:unread={!message.isRead}>
						<div class="inbox-heading">
							<h3>{message.title}</h3>
							<span class="account-badge">{message.isRead ? '已读' : '未读'}</span>
						</div>
						<p class="inbox-meta">
							{messageTypeLabels[message.type] ?? '站内通知'} ·
							<time datetime={message.createdAt}>{messageDate(message.createdAt)}</time>
						</p>
						{#if message.content}<p class="inbox-body">{message.content}</p>{/if}
						<div class="inbox-actions">
							{#if message.data?.item}<a
									class="account-button secondary"
									href={resolve(itemPath(message.data.item) as '/')}>查看已发布内容</a
								>{/if}{#if message.data?.submissionId}<a
									class="account-button secondary"
									href={resolve(
										`/user/submissions?submission=${message.data.submissionId}#submission-detail`
									)}>查看投稿与审核意见</a
								>{/if}{#if !message.isRead}<form
									method="POST"
									action={messageUrl('/user/messages', data.filters) +
										(messageUrl('/user/messages', data.filters).includes('?') ? '&' : '?') +
										'/read'}
									onsubmit={(event) => read(event, message.id)}
								>
									<input name="id" type="hidden" value={message.id} /><button
										class="account-button secondary"
										disabled={busy !== null}>{busy === message.id ? '标记中…' : '标为已读'}</button
									>
								</form>{/if}
						</div>
					</li>{/each}
			</ul>{:else}<div class="inbox-empty">
				<h3>{data.filters.status === 'unread' ? '没有匹配的未读消息' : '暂无匹配消息'}</h3>
				<p>
					{data.filters.q || data.filters.type !== 'all' || data.filters.status !== 'all'
						? '可调整条件或重置筛选。'
						: '投稿审核结果和重要通知会显示在这里。'}
				</p>
			</div>{/if}
		{#if data.pageCount > 1}<nav class="inbox-pagination" aria-label="消息分页">
				{#if data.filters.page > 1}<a
						class="account-button secondary"
						href={resolve(
							messageUrl('/user/messages', data.filters, { page: data.filters.page - 1 }) as '/'
						)}>上一页</a
					>{/if}<span>第 {data.filters.page} / {data.pageCount} 页</span
				>{#if data.filters.page < data.pageCount}<a
						class="account-button secondary"
						href={resolve(
							messageUrl('/user/messages', data.filters, { page: data.filters.page + 1 }) as '/'
						)}>下一页</a
					>{/if}
			</nav>{/if}
	</section></AccountShell
>

<style>
	.inbox :global(.account-button) {
		min-height: 44px;
	}
	.inbox :global(.account-card-header p) {
		color: var(--ui-muted);
	}
	.inbox {
		min-width: 0;
	}
	.inbox-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: end;
		margin: 20px 0;
	}
	.inbox-filters label {
		display: grid;
		gap: 6px;
		flex: 1;
		min-width: 140px;
		font-size: 0.875rem;
	}
	.inbox-filters input,
	.inbox-filters select {
		width: 100%;
		min-height: 44px;
		padding: 10px;
		border: 1px solid var(--ui-line);
		border-radius: 10px;
		background: var(--ui-surface);
		color: var(--ui-text);
	}
	.inbox-meta {
		font-size: 0.875rem;
		color: var(--ui-muted);
		overflow-wrap: anywhere;
	}
	.inbox-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.inbox-list li {
		padding: 22px 0;
		border-bottom: 1px solid var(--ui-line);
		overflow-wrap: anywhere;
	}
	.inbox-heading {
		display: flex;
		align-items: start;
		gap: 12px;
		justify-content: space-between;
	}
	.inbox-heading h3 {
		margin: 0;
		font-size: 1rem;
		line-height: 1.6;
	}
	.inbox-heading .account-badge {
		flex-shrink: 0;
	}
	.inbox-body {
		white-space: pre-wrap;
		line-height: 1.8;
	}
	.inbox-actions,
	.inbox-pagination {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
	}
	.inbox-pagination {
		justify-content: center;
		margin-top: 24px;
	}
	.inbox-notice {
		padding: 14px;
		background: var(--ui-surface);
		border: 1px solid var(--ui-line);
		border-radius: 10px;
	}
	.inbox-empty {
		padding: 28px 0;
	}
	.inbox-empty p {
		color: var(--ui-muted);
	}
	@media (max-width: 600px) {
		.inbox-filters label {
			flex-basis: 100%;
		}
		.inbox-filters {
			align-items: stretch;
		}
		.inbox-actions .account-button {
			white-space: normal;
			text-align: center;
		}
	}
</style>
