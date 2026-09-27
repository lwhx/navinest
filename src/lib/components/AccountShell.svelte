<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import './account.css';
	let {
		title,
		description,
		eyebrow = 'ACCOUNT',
		role,
		children
	}: {
		title: string;
		description: string;
		eyebrow?: string;
		role?: string;
		children: Snippet;
	} = $props();
	const links = [
		{ label: '个人空间', href: resolve('/user') },
		{ label: '我的投稿', href: resolve('/user/submissions') },
		{ label: '站内消息', href: resolve('/user/messages') },
		{ label: '账号安全', href: resolve('/user/settings') },
		{ label: '提交内容', href: resolve('/contribute') }
	];
</script>

<PublicShell {title}>
	<section class="account-hero">
		<div>
			<p>{eyebrow}</p>
			<h1>{title}</h1>
			<span>{description}</span>
		</div>
		<div class="account-hero-mark" aria-hidden="true">N</div>
	</section>
	<nav class="account-subnav" aria-label="账户导航">
		{#each links as link (link.href)}<a href={link.href}>{link.label}</a>{/each}
		{#if role === 'admin'}<a class="admin-entry" href={resolve('/admin')}>管理后台</a>{/if}
	</nav>
	<div class="account-content">{@render children()}</div>
</PublicShell>
