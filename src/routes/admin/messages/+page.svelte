<script lang="ts">
	import { scrollableTable } from '$lib/admin-actions';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);

	let scope = $state('all');

	const typeLabels: Record<string, string> = {
		announcement: '公告',
		system: '系统通知',
		submission_review: '投稿通知'
	};

	function value(name: string, fallback = ''): string {
		const submitted = form?.values?.[name];
		return typeof submitted === 'string' ? submitted : fallback;
	}

	function stamp(input: string) {
		return input.replace('T', ' ').replace('Z', '').slice(0, 16);
	}

	function readRatio(batch: { recipients: number; read: number }) {
		if (!batch.recipients) return '—';
		return `${batch.read}/${batch.recipients}`;
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Notices</p>
		<h1>消息管理</h1>
		<p class="admin-page-note">
			向站内用户发送公告或系统通知，并跟踪每个批次的已读情况；撤回会删除该批次全部未读与已读消息。
		</p>
	</div>
</header>
{#if data.source === 'fallback'}<p class="admin-notice">本地示例为只读数据。</p>{/if}
{#if form?.message}<p class="admin-form-message" role="alert">{form.message}</p>{/if}

<section class="admin-stat-strip" aria-label="消息统计">
	<article>
		<p>发送批次</p>
		<strong>{data.stats.batches}</strong>
	</article>
	<article>
		<p>公告</p>
		<strong>{data.stats.announcements}</strong>
	</article>
	<article>
		<p>系统通知</p>
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
	<section class="admin-editor" aria-labelledby="message-compose-title">
		<div class="admin-editor-header">
			<h2 id="message-compose-title">发送通知</h2>
		</div>
		<form class="admin-form" method="POST" action="?/send">
			<div class="admin-form-grid">
				<label
					><span>接收范围</span><select name="scope" bind:value={scope}
						><option value="all">全部启用用户</option><option value="admins">仅管理员</option
						><option value="user">指定用户</option></select
					>{#if errors.scope}<small class="field-error">{errors.scope}</small>{/if}</label
				>
				{#if scope === 'user'}
					<label
						><span>接收用户</span><select name="userId" value={value('userId')}
							><option value="">请选择用户</option
							>{#each data.recipients as recipient (recipient.id)}
								<option value={recipient.id}
									>{recipient.displayName}（@{recipient.username}）</option
								>{/each}</select
						>{#if errors.userId}<small class="field-error">{errors.userId}</small>{/if}</label
					>
				{/if}
				<label
					><span>消息类型</span><select name="type" value={value('type', 'announcement')}
						><option value="announcement">公告</option><option value="system">系统通知</option
						></select
					>{#if errors.type}<small class="field-error">{errors.type}</small>{/if}</label
				>
				<label class="admin-field-wide"
					><span>标题</span><input
						name="title"
						maxlength="120"
						required
						value={value('title')}
					/>{#if errors.title}<small class="field-error">{errors.title}</small>{/if}</label
				>
				<label class="admin-field-wide"
					><span>正文</span><textarea name="content" rows="4" maxlength="2000"
						>{value('content')}</textarea
					>{#if errors.content}<small class="field-error">{errors.content}</small>{/if}</label
				>
			</div>
			<div class="admin-form-actions">
				<button class="admin-primary-button" type="submit">发送通知</button>
			</div>
		</form>
	</section>
{/if}

<div
	class="admin-table-wrap"
	use:scrollableTable
	role="region"
	aria-label="管理数据列表，可横向滚动"
>
	<table class="admin-table">
		<thead
			><tr
				><th>标题</th><th>类型</th><th>发送者</th><th>接收</th><th>已读</th><th>发送时间</th
				>{#if data.source === 'database'}<th>操作</th>{/if}</tr
			></thead
		><tbody
			>{#each data.batches as batch (batch.batchId)}<tr>
					<td><strong>{batch.title}</strong></td>
					<td>{typeLabels[batch.type] ?? batch.type}</td>
					<td>{batch.sender ?? '系统'}</td>
					<td>{batch.recipients}</td>
					<td>{readRatio(batch)}</td>
					<td><time datetime={batch.createdAt}>{stamp(batch.createdAt)}</time></td>
					{#if data.source === 'database'}<td>
							<div class="admin-row-actions">
								<form
									method="POST"
									action="?/withdraw"
									onsubmit={(event) => {
										if (
											!confirm(
												`确定撤回“${batch.title}”？将删除该批次 ${batch.recipients} 条消息，包含已读消息。`
											)
										)
											event.preventDefault();
									}}
								>
									<input type="hidden" name="batchId" value={batch.batchId} />
									<button type="submit">撤回</button>
								</form>
							</div>
						</td>{/if}
				</tr>{/each}
			{#if !data.batches.length}<tr
					><td colspan="7" class="admin-message-empty"
						>还没有通过后台发送的通知。投稿审核结果由系统自动生成，不计入批次。</td
					></tr
				>{/if}
		</tbody>
	</table>
</div>

<p class="admin-page-note">
	接收范围按账号状态过滤：只发送给状态为“启用”的账号。指定用户被停用后会从下拉列表中移除。
</p>

<style>
	.admin-page-note {
		margin: 6px 0 0;
		color: #7b8087;
		font-size: 13px;
	}

	.admin-stat-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 16px;
	}

	.admin-stat-strip article {
		min-width: 128px;
		padding: 12px 14px;
		border: 1px solid #e4e7eb;
		border-radius: 12px;
		background: #fbfcfd;
	}

	.admin-stat-strip p {
		margin: 0;
		color: #7b8087;
		font-size: 12px;
	}

	.admin-stat-strip strong {
		font-size: 22px;
	}

	.admin-message-empty {
		text-align: center;
		color: #8b8f95;
	}

	.admin-form-grid label.admin-field-wide textarea {
		min-height: 96px;
		padding: 10px 12px;
	}

	@media (max-width: 900px) {
		.admin-stat-strip article {
			flex: 1 1 128px;
		}
	}
</style>
