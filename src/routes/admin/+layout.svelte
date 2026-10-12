<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { appConfig } from '$lib/config';
	import { adminNavigation, adminLocation } from '$lib/admin-navigation';
	import { modalDrawer } from '$lib/ui-actions';
	import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import '../admin-base.css';
	import '../admin-productization.css';
	import '../admin-content-workbench.css';
	import '../admin-content-ordering.css';
	import '../admin-content-modal.css';
	import '../admin-workspace.css';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let menuOpen = $state(false);
	let sidebar = $state<HTMLElement>();
	const location = $derived(adminLocation(page.url.pathname));

	$effect(() => {
		if (!menuOpen || !sidebar) return;
		const drawer = modalDrawer(sidebar, () => (menuOpen = false));
		const htmlOverflow = document.documentElement.style.overflow;
		const bodyOverflow = document.body.style.overflow;
		document.documentElement.style.overflow = document.body.style.overflow = 'hidden';
		return () => {
			drawer.destroy();
			document.documentElement.style.overflow = htmlOverflow;
			document.body.style.overflow = bodyOverflow;
		};
	});
</script>

<svelte:head>
	<title>{location.label} | {appConfig.displayName}</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="admin-shell">
	{#if menuOpen}<button
			class="admin-mobile-backdrop"
			data-drawer-backdrop
			type="button"
			aria-label="关闭后台菜单遮罩"
			onclick={() => (menuOpen = false)}
		></button>{/if}
	<aside
		bind:this={sidebar}
		id="admin-navigation"
		class="admin-sidebar"
		class:open={menuOpen}
		role={menuOpen ? 'dialog' : undefined}
		aria-modal={menuOpen ? true : undefined}
		aria-label="后台菜单"
	>
		<div class="admin-sidebar-heading">
			{#if menuOpen}<button
					class="admin-menu-close"
					type="button"
					aria-label="关闭后台菜单"
					onclick={() => (menuOpen = false)}><AdminIcon name="close" /></button
				>{/if}
			<a class="admin-brand" href={resolve('/admin')} onclick={() => (menuOpen = false)}
				><span>N</span>
				<div><strong>{appConfig.name}</strong><small>管理后台</small></div></a
			>
		</div>
		<nav aria-label="后台导航">
			{#each adminNavigation as group (group.label)}
				<div class="admin-nav-group">
					<p>{group.label}</p>
					{#each group.items as item (item.href)}
						<a
							class:active={location.href === item.href}
							aria-current={location.href === item.href ? 'page' : undefined}
							href={resolve(item.href)}
							onclick={() => (menuOpen = false)}
							><AdminIcon name={item.icon} /><span>{item.label}</span></a
						>
					{/each}
				</div>
			{/each}
		</nav>
		<div class="admin-sidebar-footer">
			<a class="admin-public-link" href={resolve('/')} target="_blank" rel="noopener noreferrer"
				><AdminIcon name="external" /><span>查看前台</span></a
			>
		</div>
	</aside>
	<div class="admin-workspace">
		<header class="admin-topbar">
			<button
				class="admin-menu-button"
				type="button"
				aria-label="打开后台菜单"
				aria-controls="admin-navigation"
				aria-expanded={menuOpen}
				onclick={() => (menuOpen = true)}><AdminIcon name="menu" /></button
			>
			<nav class="admin-breadcrumb" aria-label="后台面包屑">
				<a href={resolve('/admin')}>工作台</a>{#if location.href !== '/admin'}<span
						aria-hidden="true">/</span
					><strong>{location.label}</strong>{/if}
			</nav>
			{#if data.admin.source === 'local'}<span class="admin-local-badge">本地预览</span>{/if}
			<div class="admin-topbar-actions">
				<ThemeToggle /><a
					class="admin-account-link"
					href={resolve('/user/settings')}
					aria-label="查看账号安全"
					><span class="admin-avatar" aria-hidden="true">{data.admin.displayName.slice(0, 1)}</span
					><span><strong>{data.admin.displayName}</strong><small>账号安全</small></span></a
				>
			</div>
		</header>
		<main id="admin-main" class="admin-main" tabindex="-1">{@render children()}</main>
	</div>
</div>
