<script lang="ts">
	import { resolve } from '$app/paths';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>登录 | NaviNest 导航巢</title></svelte:head>
<AccountShell
	title="登录 NaviNest"
	description="进入你的个人空间，同步收藏、足迹、投稿和专属导航。"
	eyebrow="WELCOME BACK"
>
	<section class="account-card account-login">
		<div class="account-card-header">
			<div>
				<h2>账号登录</h2>
				<p>使用NaviNest账号继续</p>
			</div>
		</div>
		{#if form?.message}<p class="account-note" role="alert">{form.message}</p>{/if}
		<form class="account-form" method="POST">
			<label class="account-wide"
				><span>用户名或邮箱</span><input
					name="identifier"
					autocomplete="username"
					required
					value={form?.identifier ?? ''}
					placeholder="输入用户名或邮箱"
				/></label
			>
			<label class="account-wide"
				><span>密码</span><input
					name="password"
					type="password"
					autocomplete="current-password"
					required
					placeholder="输入密码"
				/></label
			>
			<button class="account-button account-wide" type="submit">登录</button>
		</form>
		<div class="account-divider">或者</div>
		<div class="account-actions">
			<a class="account-button secondary" href={resolve('/api/auth/github')}>使用 GitHub 登录</a
			>{#if data.registrationOpen}<a class="account-button secondary" href={resolve('/register')}
					>注册新账号</a
				>{/if}<a class="account-button secondary" href={resolve('/')}>返回首页</a>
		</div>
	</section>
</AccountShell>
