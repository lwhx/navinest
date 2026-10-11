<script lang="ts">
	import { resolve } from '$app/paths';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);

	function value(name: string): string {
		const submitted = (form?.values as Record<string, string> | undefined)?.[name];
		return typeof submitted === 'string' ? submitted : '';
	}
</script>

<svelte:head><title>注册 | NaviNest 导航巢</title></svelte:head>
<AccountShell
	title="注册 NaviNest"
	description="创建账号后可以收藏入口、提交投稿，并同步自己的导航与足迹。"
	eyebrow="CREATE ACCOUNT"
	showNav={false}
>
	<section class="account-card account-login">
		{#if !data.registrationOpen}
			<div class="account-card-header">
				<div>
					<h2>暂未开放注册</h2>
					<p>站点当前只允许管理员开通账号，请联系站长。</p>
				</div>
			</div>
			<div class="account-actions">
				<a class="account-button secondary" href={resolve('/login')}>已有账号，去登录</a><a
					class="account-button secondary"
					href={resolve('/')}>返回首页</a
				>
			</div>
		{:else}
			<div class="account-card-header">
				<div>
					<h2>创建账号</h2>
					<p>用户名用于登录，密码至少 8 位。</p>
				</div>
			</div>
			{#if form?.message}<p class="account-note" role="alert">{form.message}</p>{/if}
			<form class="account-form" method="POST">
				<label class="account-wide"
					><span>用户名</span><input
						name="username"
						required
						minlength="3"
						maxlength="32"
						autocomplete="username"
						value={value('username')}
						placeholder="字母、数字、点、下划线或连字符"
					/>{#if errors.username}<small class="register-error">{errors.username}</small>{/if}</label
				>
				<label class="account-wide"
					><span>显示名称</span><input
						name="displayName"
						required
						maxlength="80"
						value={value('displayName')}
					/>{#if errors.displayName}<small class="register-error">{errors.displayName}</small
						>{/if}</label
				>
				<label class="account-wide"
					><span>邮箱（可选）</span><input
						name="email"
						type="email"
						maxlength="160"
						autocomplete="email"
						value={value('email')}
					/>{#if errors.email}<small class="register-error">{errors.email}</small>{/if}</label
				>
				<label class="account-wide"
					><span>密码</span><input
						name="password"
						type="password"
						required
						minlength="8"
						maxlength="128"
						autocomplete="new-password"
					/>{#if errors.password}<small class="register-error">{errors.password}</small>{/if}</label
				>
				<button class="account-button account-wide" type="submit">注册并登录</button>
			</form>
			<div class="account-actions">
				<a class="account-button secondary" href={resolve('/login')}>已有账号，去登录</a>
			</div>
		{/if}
	</section>
</AccountShell>

<style>
	.register-error {
		display: block;
		margin-top: 4px;
		color: #b42318;
		font-size: 12px;
	}
</style>
