<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { invalidateAll, beforeNavigate } from '$app/navigation';
	import { messageDate, messageTypeLabels, messageUrl } from '$lib/messages';
	import type { MessagePreview } from '$lib/server/services/admin-messages';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let previewHeading = $state<HTMLHeadingElement | null>(null),
		previewPanel = $state<HTMLDivElement | null>(null);
	let preview = $state<MessagePreview | null>(null),
		draft = $state<Record<string, string>>({}),
		busy = $state(false),
		notice = $state(''),
		editing = $state(false),
		uncertain = $state(false),
		done = $state(false);
	beforeNavigate(({ cancel }) => {
		if (busy) cancel();
	});

	const values = $derived((form && 'values' in form ? form.values : {}) as Record<string, string>);
	const errors = $derived((form && 'errors' in form ? form.errors : {}) as Record<string, string>);
	const current = $derived(
		editing ? null : (preview ?? (form && 'preview' in form ? form.preview : null))
	);
	const saved = $derived(Object.keys(draft).length ? draft : values);
	const value = (name: string, fallback = '') => saved[name] ?? fallback;
	async function compose(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		const entries = Object.fromEntries(
			new FormData(event.currentTarget as HTMLFormElement)
		) as Record<string, string>;
		draft = entries;
		busy = true;
		notice = '';
		try {
			const response = await fetch('/api/admin/messages', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ ...entries, action: 'preview' }),
					signal: AbortSignal.timeout(20000)
				}),
				body = await response.json();
			if (!response.ok)
				throw new Error(
					body.error === 'Validation failed'
						? Object.values(body.fields ?? {}).join(' ')
						: body.error || '检查失败。'
				);
			preview = body.preview;
			editing = false;
			uncertain = false;
			done = false;
			await tick();
			previewPanel?.scrollIntoView({ block: 'start' });
			previewHeading?.focus({ preventScroll: true });
		} catch (error) {
			notice =
				error instanceof Error &&
				!['TypeError', 'SyntaxError', 'AbortError', 'TimeoutError'].includes(error.name)
					? error.message
					: '检查未完成，请检查网络后重试；填写内容已保留。';
		} finally {
			busy = false;
		}
	}
	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !current || done) return;
		busy = true;
		notice = '';
		try {
			const response = await fetch('/api/admin/messages', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ ...saved, proof: current, confirmed: true }),
					signal: AbortSignal.timeout(30000)
				}),
				body = await response.json();
			if (!response.ok) {
				uncertain = response.status >= 500;
				if (!uncertain) notice = body.error || '发送未完成，请重新核对。';
				else throw new Error();
				return;
			}
			done = true;
			uncertain = false;
			notice = body.withdrawnAt
				? '该批次已撤回，没有重新发送。'
				: `发送完成，共 ${body.recipients} 位接收用户${body.repeated ? '（已核对原批次，没有重复发送）' : ''}。`;
			try {
				await invalidateAll();
			} catch {
				notice += ' 历史列表刷新失败，可稍后刷新。';
			}
		} catch {
			uncertain = true;
			notice = '发送结果待核对。沿用此批次重试可核对结果，不会重复发送；也可查看发送历史。';
		} finally {
			busy = false;
		}
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">MESSAGES</p>
		<h1>站内消息</h1>
		<p class="admin-page-note">先核对接收范围和内容，再发送。发送历史与时间统一按北京时间展示。</p>
	</div>
</header>
{#if data.source === 'fallback'}<p class="admin-notice">数据库当前不可用。</p>{/if}
{#if notice || form?.message}<p class="admin-form-message" role="status">
		{notice || form?.message}
	</p>{/if}
<section class="admin-stat-strip" aria-label="消息统计">
	<article>
		<p>发送批次</p>
		<strong>{data.stats.batches}</strong>
	</article>
	<article>
		<p>公告消息</p>
		<strong>{data.stats.announcements}</strong>
	</article>
	<article>
		<p>系统消息</p>
		<strong>{data.stats.system}</strong>
	</article>
	<article>
		<p>投稿通知</p>
		<strong>{data.stats.review}</strong>
	</article>
	<article>
		<p>未读消息</p>
		<strong>{data.stats.unread}</strong>
	</article>
</section>
{#if data.source === 'database'}
	<section class="admin-editor message-compose" aria-labelledby="compose-title" aria-busy={busy}>
		<div class="admin-editor-header">
			<h2 id="compose-title">{current ? '核对并发送' : '撰写通知'}</h2>
		</div>
		{#if current}
			<div class="message-preview" bind:this={previewPanel}>
				<p><strong>接收范围：</strong>{current.scopeLabel}</p>
				<p><strong>接收人数：</strong>{current.recipients} 人</p>
				<p><strong>类型：</strong>{messageTypeLabels[current.type] ?? current.type}</p>
				<h3 tabindex="-1" bind:this={previewHeading}>{current.title}</h3>
				<p class="message-body">{current.content || '（无正文）'}</p>
				<p class="message-meta">
					批次 {current.batchId} · 预览有效期 15 分钟，接收账号变化后需重新核对。
				</p>
			</div>
			<form class="message-send-form" method="POST" action="?/send" onsubmit={send}>
				{#each ['scope', 'userId', 'type', 'title', 'content'] as key (key)}<input
						type="hidden"
						name={key}
						value={value(key)}
					/>{/each}
				{#each ['batchId', 'digest', 'createdAt', 'recipients', 'scopeLabel'] as key (key)}<input
						type="hidden"
						name={key}
						value={String(current[key as keyof typeof current] ?? '')}
					/>{/each}
				<label class="checkbox-field"
					><input
						type="checkbox"
						name="confirmed"
						value="yes"
						required
						disabled={busy || done}
					/><span>我已核对接收范围、人数和消息内容</span></label
				>
				<div class="admin-form-actions">
					<button class="admin-primary-button" disabled={busy || done}
						>{busy
							? '处理中…'
							: done
								? '已完成'
								: uncertain
									? '核对并重试同一批次'
									: '确认发送'}</button
					>
					<button
						class="admin-secondary-button"
						type="submit"
						formaction="?/edit"
						formnovalidate
						disabled={busy || uncertain || done}
						onclick={(event) => {
							event.preventDefault();
							editing = true;
							notice = '';
						}}>修改内容</button
					>
					<a
						class="admin-secondary-button"
						href={resolve(`/admin/messages?batch=${current.batchId}#message-batch`)}>查看该批次</a
					>
					{#if done}<a
							class="admin-secondary-button"
							href={resolve('/admin/messages')}
							onclick={() => {
								preview = null;
								draft = { scope: 'all', userId: '', type: 'announcement', title: '', content: '' };
								editing = true;
								done = false;
								uncertain = false;
								notice = '';
							}}>撰写新通知</a
						>{/if}
				</div>
			</form>
		{:else}
			<details class="message-recipient-search">
				<summary>查找指定接收用户</summary>
				<form method="GET" action={resolve('/admin/messages')} class="message-filters">
					<label
						>用户名、昵称或编号<input
							name="recipientQ"
							value={data.recipientQuery}
							maxlength="100"
						/></label
					><button class="admin-secondary-button">查找用户</button>
				</form>
				<ul>
					{#each data.recipients as recipient (recipient.id)}<li>
							#{recipient.id} · {recipient.displayName}（@{recipient.username}）{recipient.role ===
							'admin'
								? ' · 管理员'
								: ''}
						</li>{:else}<li>没有匹配的启用用户。</li>{/each}
				</ul>
				{#if data.hasMore}<p>仅展示前 20 位，请缩小查找范围。</p>{/if}
			</details>
			<form class="admin-form" method="POST" action="?/preview" onsubmit={compose}>
				<fieldset disabled={busy} class="message-fields">
					<div class="admin-form-grid">
						<label
							><span>接收范围</span><select name="scope" value={value('scope', 'all')}
								><option value="all">全部启用用户</option><option value="admins"
									>仅启用管理员</option
								><option value="user">指定用户</option></select
							></label
						>
						<label
							><span>用户编号（指定用户时填写）</span><input
								name="userId"
								type="number"
								min="1"
								step="1"
								value={value('userId')}
								placeholder="可展开上方查找用户"
							/>{#if errors.userId}<small class="field-error">{errors.userId}</small>{/if}</label
						>
						<label
							><span>消息类型</span><select name="type" value={value('type', 'announcement')}
								><option value="announcement">公告</option><option value="system">系统通知</option
								></select
							></label
						>
						<label class="admin-field-wide"
							><span>标题</span><input
								name="title"
								value={value('title')}
								maxlength="120"
								required
							/>{#if errors.title}<small class="field-error">{errors.title}</small>{/if}</label
						>
						<label class="admin-field-wide"
							><span>正文</span><textarea name="content" rows="5" maxlength="2000"
								>{value('content')}</textarea
							>{#if errors.content}<small class="field-error">{errors.content}</small>{/if}</label
						>
					</div>
					<div class="admin-form-actions">
						<button class="admin-primary-button">{busy ? '检查中…' : '预览接收范围与内容'}</button>
					</div>
				</fieldset>
			</form>
		{/if}
	</section>{/if}
{#if data.selected}<section
		class="admin-editor message-detail"
		id="message-batch"
		aria-label="批次详情"
	>
		<h2>{data.selected.title}</h2>
		<p>
			{messageTypeLabels[data.selected.type] ?? data.selected.type} · {data.selected.recipients} 人 ·
			已读 {data.selected.read} 人 · {messageDate(data.selected.createdAt)}
		</p>
		<p class="message-meta">批次 {data.selected.batchId}</p>
		{#if data.selected.withdrawnAt}<p>
				已撤回 · {messageDate(
					data.selected.withdrawnAt
				)}。用户端不再显示此批次，重复请求不会重新发送。
			</p>{:else}<p class="message-body">{data.selected.content || '（无正文）'}</p>
			<form method="POST" action="?/withdraw">
				<input type="hidden" name="batchId" value={data.selected.batchId} /><label
					class="checkbox-field"
					><input type="checkbox" name="confirmed" value="yes" required /><span
						>确认撤回此批次；所有接收用户都将无法继续查看，已读数量保留供核对</span
					></label
				><button class="admin-secondary-button">撤回此批次</button>
			</form>{/if}
	</section>{/if}
<section class="admin-editor message-history" aria-label="发送历史">
	<h2>发送历史</h2>
	<form class="message-filters" method="GET" action={resolve('/admin/messages')}>
		<label
			>搜索消息<input
				type="search"
				name="q"
				value={data.filters.q}
				maxlength="160"
				placeholder="标题或正文"
			/></label
		><label
			>消息类型<select name="type" value={data.filters.type}
				><option value="all">全部类型</option><option value="announcement">公告</option><option
					value="system">系统通知</option
				></select
			></label
		><label
			>发送状态<select name="status" value={data.filters.status}
				><option value="all">全部状态</option><option value="sent">已发送</option><option
					value="withdrawn">已撤回</option
				></select
			></label
		><button class="admin-primary-button">筛选</button><a
			class="admin-secondary-button"
			href={resolve('/admin/messages')}>重置</a
		>
	</form>
	<p class="message-meta">
		共 {data.total} 个匹配批次 · 第 {data.filters.page} / {data.pageCount} 页 · 每页 20 条
	</p>
	<ul class="message-batches">
		{#each data.batches as batch (batch.batchId)}<li>
				<div>
					<h3>{batch.title}</h3>
					<p>
						{messageTypeLabels[batch.type] ?? batch.type} · {batch.sender ?? '系统'} · {messageDate(
							batch.createdAt
						)}
					</p>
					<p>
						{batch.withdrawnAt ? '已撤回' : '已发送'} · 接收 {batch.recipients} 人 · 已读 {batch.read}
						人
					</p>
				</div>
				<a
					class="admin-secondary-button"
					href={resolve(
						(
							messageUrl('/admin/messages', data.filters) +
							'&batch=' +
							encodeURIComponent(batch.batchId) +
							'#message-batch'
						).replace('/admin/messages&', '/admin/messages?') as '/'
					)}>查看批次</a
				>
			</li>{:else}<li>暂无匹配批次，可调整筛选条件。</li>{/each}
	</ul>
	{#if data.pageCount > 1}<nav class="message-pagination" aria-label="发送历史分页">
			{#if data.filters.page > 1}<a
					class="admin-secondary-button"
					href={resolve(
						messageUrl('/admin/messages', data.filters, { page: data.filters.page - 1 }) as '/'
					)}>上一页</a
				>{/if}<span>第 {data.filters.page} / {data.pageCount} 页</span
			>{#if data.filters.page < data.pageCount}<a
					class="admin-secondary-button"
					href={resolve(
						messageUrl('/admin/messages', data.filters, { page: data.filters.page + 1 }) as '/'
					)}>下一页</a
				>{/if}
		</nav>{/if}
</section>

<style>
	.message-preview,
	.message-send-form {
		padding: 20px;
		scroll-margin-top: 90px;
	}
	.message-history,
	.message-detail {
		padding: 24px;
	}
	@media (max-width: 600px) {
		.message-history,
		.message-detail,
		.message-preview,
		.message-send-form {
			padding: 16px;
		}
	}

	.message-fields {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	.message-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: end;
		margin: 16px 0;
	}
	.message-filters label {
		display: grid;
		gap: 6px;
		flex: 1;
		min-width: 140px;
	}
	.message-filters input,
	.message-filters select {
		width: 100%;
		min-height: 44px;
		padding: 10px;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		background: var(--admin-surface);
		color: var(--admin-text);
	}
	.message-preview,
	.message-detail {
		overflow-wrap: anywhere;
	}
	.message-body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.8;
	}
	.message-meta {
		color: var(--admin-muted);
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}
	.message-recipient-search {
		margin-bottom: 20px;
	}
	.message-recipient-search summary {
		cursor: pointer;
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	.message-recipient-search ul {
		padding-left: 20px;
		line-height: 1.8;
	}
	.message-batches {
		padding: 0;
		list-style: none;
	}
	.message-batches li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 0;
		border-bottom: 1px solid var(--admin-border);
	}
	.message-batches li > div {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.message-batches h3 {
		margin: 0;
		font-size: 1rem;
	}
	.message-batches p {
		margin: 6px 0;
		color: var(--admin-muted);
	}
	.message-pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		margin-top: 20px;
	}
	.message-compose,
	.message-history,
	.message-detail {
		margin-bottom: 24px;
	}
	.message-detail {
		scroll-margin-top: 90px;
	}
	.message-detail h2 {
		overflow-wrap: anywhere;
	}
	.message-detail .checkbox-field {
		margin: 16px 0;
	}
	@media (max-width: 600px) {
		.message-batches li {
			align-items: start;
			flex-direction: column;
		}
		.message-filters {
			align-items: stretch;
		}
		.message-filters label {
			flex-basis: 100%;
		}
		.message-pagination {
			flex-wrap: wrap;
		}
	}
</style>
