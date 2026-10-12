<script lang="ts">
	import { resolve } from '$app/paths';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const adminLogin = $derived(data.returnTo.startsWith('/admin'));
</script>

<svelte:head><title>登录 | NaviNest 导航巢</title></svelte:head>
<AccountShell
	title={adminLogin ? '登录管理后台' : '登录 NaviNest'}
	description={adminLogin
		? '使用已有管理员账号登录，完成后返回刚才的后台页面。'
		: '进入你的个人空间，同步收藏、足迹、投稿和专属导航。'}
	eyebrow="WELCOME BACK"
	showNav={false}
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
		{#if data.githubLoginEnabled || data.registrationOpen}<div class="account-divider">
				或者
			</div>{/if}
		<div class="account-actions">
			{#if data.githubLoginEnabled}<a
					class="account-button secondary"
					href={adminLogin
						? resolve(`/api/auth/github?returnTo=${encodeURIComponent(data.returnTo)}`)
						: resolve('/api/auth/github')}>使用 GitHub 登录</a
				>{/if}{#if data.registrationOpen}<a
					class="account-button secondary"
					href={resolve('/register')}>注册新账号</a
				>{/if}<a class="account-button secondary" href={resolve('/')}>返回首页</a>
		</div>
	</section>
</AccountShell>
