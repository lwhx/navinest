<script lang="ts">
	import { resolve } from '$app/paths';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let type = $state('site'),
		title = $state(''),
		summary = $state(''),
		content = $state(''),
		url = $state(''),
		message = $state(''),
		submitting = $state(false);
	const typeNotes: Record<string, string> = {
		site: '推荐值得长期使用的网站或在线工具。',
		post: '分享有参考价值的文章、教程或观点。',
		app: '推荐桌面端、移动端或跨平台应用。',
		book: '推荐书籍、影视或其他长期内容。'
	};
	async function submit() {
		submitting = true;
		const response = await fetch('/api/submissions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ type, title, summary, content, url })
			}),
			body = await response.json();
		submitting = false;
		if (!response.ok) {
			message = body.error;
			return;
		}
		location.href = resolve('/user/submissions');
	}
</script>

<svelte:head><title>投稿 | NaviNest 导航巢</title></svelte:head>
<AccountShell
	title="提交内容"
	description={`${data.user.displayName}，推荐你认为值得被更多人发现的内容。`}
	eyebrow="CONTRIBUTE"
>
	<div class="account-grid">
		<section class="account-card">
			<div class="account-card-header">
				<div>
					<h2>投稿表单</h2>
					<p>管理员审核通过后将公开发布</p>
				</div>
			</div>
			{#if message}<p class="account-note" role="alert">{message}</p>{/if}
			<form
				class="account-form"
				onsubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<label
					><span>内容类型</span><select bind:value={type}
						><option value="site">网址</option><option value="post">文章</option><option value="app"
							>应用</option
						><option value="book">书籍影视</option></select
					></label
				>
				<label
					><span>标题</span><input
						bind:value={title}
						maxlength="160"
						required
						placeholder="清晰描述推荐内容"
					/></label
				>
				<label class="account-wide"
					><span>目标网址</span><input bind:value={url} type="url" placeholder="https://" /></label
				>
				<label class="account-wide"
					><span>简介</span><textarea
						bind:value={summary}
						rows="4"
						maxlength="500"
						placeholder="用几句话说明它为什么值得收录"></textarea></label
				>
				<label class="account-wide"
					><span>正文或补充说明</span><textarea
						bind:value={content}
						rows="8"
						maxlength="20000"
						placeholder="可补充使用场景、内容提要或推荐理由"></textarea></label
				>
				<div class="account-wide account-actions">
					<button class="account-button" type="submit" disabled={submitting}
						>{submitting ? '提交中…' : '提交审核'}</button
					><a class="account-button secondary" href={resolve('/user/submissions')}>查看投稿记录</a>
				</div>
			</form>
		</section>
		<aside class="account-card">
			<div class="account-card-header">
				<div>
					<h2>投稿提示</h2>
					<p>{typeNotes[type]}</p>
				</div>
			</div>
			<ul class="account-list">
				<li>
					<div>
						<strong>真实有效</strong>
						<p>请确保目标链接可访问，内容描述与实际一致。</p>
					</div>
				</li>
				<li>
					<div>
						<strong>信息完整</strong>
						<p>清晰的标题和简介有助于管理员快速完成审核。</p>
					</div>
				</li>
				<li>
					<div>
						<strong>安全跳转</strong>
						<p>公开页面中的外部链接会统一经过站内安全跳转。</p>
					</div>
				</li>
			</ul>
		</aside>
	</div>
</AccountShell>
