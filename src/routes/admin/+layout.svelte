<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { appConfig } from '$lib/config';
	import '../admin-productization.css';
	import '../admin-content-workbench.css';
	import '../admin-content-ordering.css';
	import '../admin-content-modal.css';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let menuOpen = $state(false);

	const navigation = [
		{ href: resolve('/admin'), label: '概览' },
		{ href: resolve('/admin/items'), label: '内容' },
		{ href: resolve('/admin/categories'), label: '分类' },
		{ href: resolve('/admin/tags'), label: '标签' },
		{ href: resolve('/admin/submissions'), label: '投稿审核' },
		{ href: resolve('/admin/home-modules'), label: '首页模块' },
		{ href: resolve('/admin/search-engines'), label: '搜索源' },
		{ href: resolve('/admin/hot-sources'), label: '热榜源' },
		{ href: resolve('/admin/cron-runs'), label: '定时任务' },
		{ href: resolve('/admin/import-export'), label: '导入导出' },
		{ href: resolve('/admin/files'), label: '文件' }
	];

	function active(href: string): boolean {
		return href === resolve('/admin')
			? page.url.pathname === href
			: page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}
</script>

<svelte:head>
	<title>管理后台 | {appConfig.displayName}</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="admin-shell">
	{#if menuOpen}<button
			class="admin-mobile-backdrop"
			type="button"
			aria-label="关闭后台菜单"
			onclick={() => (menuOpen = false)}
		></button>{/if}
	<aside class:open={menuOpen} class="admin-sidebar">
		<a class="admin-brand" href={resolve('/admin')}
			><span>N</span><strong>{appConfig.name}</strong></a
		>
		<nav aria-label="后台导航">
			{#each navigation as item (item.href)}
				<a
					class:active={active(item.href)}
					aria-current={active(item.href) ? 'page' : undefined}
					href={item.href}
					onclick={() => (menuOpen = false)}>{item.label}</a
				>
			{/each}
		</nav>
		<a class="admin-public-link" href={resolve('/')}>查看前台</a>
	</aside>

	<div class="admin-workspace">
		<header class="admin-topbar">
			<button
				class="admin-menu-button"
				type="button"
				aria-label="打开后台菜单"
				aria-expanded={menuOpen}
				onclick={() => (menuOpen = !menuOpen)}>☰</button
			>
			<span class="admin-topbar-title">管理控制台</span>
			<div><strong>{data.admin.displayName}</strong><small>{data.admin.email}</small></div>
			{#if data.admin.source === 'local'}<span class="admin-local-badge">本地预览</span>{/if}
		</header>
		<main id="main-content" class="admin-main" tabindex="-1">{@render children()}</main>
	</div>
</div>
