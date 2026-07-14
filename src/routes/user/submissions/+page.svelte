<script lang="ts">
	import { resolve } from '$app/paths';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const labels: Record<string, string> = {
		pending: '待审核',
		approved: '已通过',
		rejected: '已拒绝',
		published: '已发布',
		draft: '草稿'
	};
</script>

<svelte:head><title>我的投稿 | NaviNest 导航巢</title></svelte:head>
<AccountShell
	title="我的投稿"
	description="跟踪每一次内容贡献的审核状态和处理意见。"
	eyebrow="CONTRIBUTIONS"
>
	<section class="account-card">
		<div class="account-card-header">
			<div>
				<h2>投稿记录</h2>
				<p>共提交 {data.submissions.length} 条内容</p>
			</div>
			<a class="account-button" href={resolve('/contribute')}>新投稿</a>
		</div>
		{#if data.submissions.length}<ul class="account-list">
				{#each data.submissions as submission (submission.id)}<li>
						<div>
							<div class="account-actions">
								<strong>{submission.title}</strong><span class="account-status {submission.status}"
									>{labels[submission.status] ?? submission.status}</span
								><span class="account-status">{submission.type}</span>
							</div>
							{#if submission.payload.summary}<p>
									{submission.payload.summary}
								</p>{/if}{#if submission.reviewMessage}<p>
									审核意见：{submission.reviewMessage}
								</p>{/if}<time datetime={submission.createdAt}>{submission.createdAt}</time>
						</div>
						{#if submission.payload.url}<a
								class="account-button secondary"
								href={resolve(`/go?url=${encodeURIComponent(submission.payload.url)}` as '/')}
								target="_blank"
								rel="external noopener noreferrer">查看目标</a
							>{/if}
					</li>{/each}
			</ul>{:else}<p class="account-empty">
				尚未提交内容。你可以推荐优质网址、文章、应用或书籍。
			</p>{/if}
	</section>
</AccountShell>
