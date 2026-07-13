<script lang="ts">
	import { resolve } from '$app/paths';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
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
	async function read(id: number) {
		const response = await fetch(`/api/user/messages/${id}/read`, { method: 'PATCH' });
		if (response.ok) location.reload();
	}
</script>

<svelte:head><title>站内消息 | NaviNest 导航巢</title></svelte:head>
<AccountShell title="站内消息" description="查看投稿审核、系统通知和内容更新提醒。" eyebrow="INBOX">
	<section class="account-card">
		<div class="account-card-header">
			<div>
				<h2>消息列表</h2>
				<p>共 {data.messages.length} 条消息</p>
			</div>
			<a class="account-button secondary" href={resolve('/user/submissions')}>我的投稿</a>
		</div>
		{#if data.messages.length}<ul class="account-list">
				{#each data.messages as message (message.id)}<li
						class:unread={!message.isRead}
						class="account-message"
					>
						<div>
							<div class="account-actions">
								<strong>{message.title}</strong>{#if !message.isRead}<span class="account-badge"
										>未读</span
									>{/if}
							</div>
							{#if message.content}<p>{message.content}</p>{/if}{#if message.data?.item}<a
									href={resolve(itemPath(message.data.item) as '/')}>查看已发布内容</a
								>{/if}<time datetime={message.createdAt}>{message.createdAt}</time>
						</div>
						{#if !message.isRead}<button
								class="account-button secondary"
								type="button"
								onclick={() => read(message.id)}>标为已读</button
							>{/if}
					</li>{/each}
			</ul>{:else}<p class="account-empty">暂无消息。投稿审核结果和重要通知会显示在这里。</p>{/if}
	</section>
</AccountShell>
