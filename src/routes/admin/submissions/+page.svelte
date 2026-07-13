<script lang="ts">
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let message = $state('');
	function slugify(value: string) {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 100);
	}
	function meta(submission: PageProps['data']['submissions'][number]) {
		const url = submission.payload.url;
		if (!url) return {};
		if (submission.type === 'site') return { site_url: url };
		if (submission.type === 'app') return { app_download_url: url };
		if (submission.type === 'book') return { book_download_url: url };
		return {};
	}
	async function review(
		submission: PageProps['data']['submissions'][number],
		decision: 'approve' | 'reject',
		form: HTMLFormElement
	) {
		const values = new FormData(form),
			body =
				decision === 'reject'
					? { decision, message: String(values.get('message') ?? '') }
					: {
							decision,
							message: String(values.get('message') ?? ''),
							item: {
								type: submission.type,
								title: String(values.get('title') ?? ''),
								slug: String(values.get('slug') ?? ''),
								summary: String(values.get('summary') ?? ''),
								content: String(values.get('content') ?? ''),
								categoryId: null,
								status: 'published',
								visibility: 'public',
								sortOrder: 0,
								isFeatured: false,
								tagIds: [],
								meta: meta(submission)
							}
						};
		const response = await fetch(`/api/admin/submissions/${submission.id}/review`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const result = await response.json();
		if (!response.ok) {
			message = result.error;
			return;
		}
		location.reload();
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Review</p>
		<h1>投稿审核</h1>
	</div>
</header>
{#if message}<p class="admin-form-message" role="alert">{message}</p>{/if}
{#if data.source === 'fallback'}<p class="admin-notice">数据库不可用，无法审核投稿。</p>{/if}
{#each data.submissions as submission (submission.id)}
	<section class="admin-editor">
		<div class="admin-editor-header">
			<h2>{submission.title}</h2>
			<span class="status-badge">{submission.status}</span>
		</div>
		<p>
			投稿人：{submission.user.displayName} (@{submission.user.username}) · {submission.type} · {submission.createdAt}
		</p>
		{#if submission.payload.url}<p>目标：{submission.payload.url}</p>{/if}
		{#if submission.status === 'pending'}<form
				class="admin-form"
				onsubmit={(event) => {
					event.preventDefault();
					review(submission, 'approve', event.currentTarget);
				}}
			>
				<label
					><span>标题</span><input
						name="title"
						value={submission.title}
						maxlength="160"
						required
					/></label
				><label
					><span>Slug</span><input
						name="slug"
						value={slugify(submission.title)}
						pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
						required
					/></label
				><label
					><span>简介</span><textarea name="summary" maxlength="500"
						>{submission.payload.summary ?? ''}</textarea
					></label
				><label
					><span>正文</span><textarea name="content">{submission.payload.content ?? ''}</textarea
					></label
				><label><span>审核意见</span><textarea name="message"></textarea></label>
				<div class="admin-form-actions">
					<button class="admin-primary-button" type="submit">审核通过并发布</button><button
						class="admin-secondary-button"
						type="button"
						onclick={(event) => {
							const form = (event.currentTarget as HTMLButtonElement).form;
							if (form) review(submission, 'reject', form);
						}}>拒绝投稿</button
					>
				</div>
			</form>{:else}<p>审核意见：{submission.reviewMessage ?? '无'}</p>{/if}
	</section>
{:else}<p class="admin-notice">暂无投稿。</p>{/each}
