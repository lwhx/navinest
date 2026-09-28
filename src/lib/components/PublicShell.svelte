<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { useSiteSettings } from '$lib/site-context';
	import './public-shell.css';
	import './public-content.css';
	import './public-detail.css';
	import './public-navigation.css';
	import './public-rankings.css';

	let { title, eyebrow, children }: { title: string; eyebrow?: string; children: Snippet } =
		$props();
	const site = useSiteSettings();
	let menuOpen = $state(false);
	const links = [
		{ label: '首页', href: resolve('/') },
		{ label: '站内搜索', href: resolve('/search') },
		{ label: '排行榜', href: resolve('/rankings') },
		{ label: '今日热点', href: resolve('/hotnews') },
		{ label: '投稿收录', href: resolve('/contribute') }
	];
	const auxiliaryLinks = [
		{ label: '投稿收录', href: resolve('/contribute') },
		{ label: '搜索规则', href: resolve('/robots.txt') }
	];
	const tabLinks = [
		{ label: '首页', symbol: '⌂', href: resolve('/') },
		{ label: '搜索', symbol: '⌕', href: resolve('/search') },
		{ label: '排行', symbol: '榜', href: resolve('/rankings') },
		{ label: '热点', symbol: '热', href: resolve('/hotnews') },
		{ label: '我的', symbol: '我', href: resolve('/user') }
	];

	function isCurrent(href: string) {
		if (href === resolve('/')) return page.url.pathname === href;
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}

	function closeMenuOnEscape(event: KeyboardEvent) {
		if (event.key === 'Escape') menuOpen = false;
	}

	$effect(() => {
		if (!menuOpen) return;
		const documentOverflow = document.documentElement.style.overflow;
		const bodyOverflow = document.body.style.overflow;
		document.documentElement.style.overflow = 'hidden';
		document.body.style.overflow = 'hidden';
		return () => {
			document.documentElement.style.overflow = documentOverflow;
			document.body.style.overflow = bodyOverflow;
		};
	});
</script>

<svelte:window onkeydown={closeMenuOnEscape} />

<header class="public-header">
	<button
		class="public-menu-button"
		type="button"
		aria-label="打开辅助菜单"
		aria-expanded={menuOpen}
		aria-controls="public-mobile-drawer"
		onclick={() => (menuOpen = !menuOpen)}>☰</button
	><a class="public-logo" href={resolve('/')}><span>N</span><strong>{site().siteName}</strong></a>
	<nav aria-label="主导航">
		{#each links as link (link.href)}<a
				href={link.href}
				class:active={isCurrent(link.href)}
				aria-current={isCurrent(link.href) ? 'page' : undefined}>{link.label}</a
			>{/each}
	</nav>
	<a
		class="public-user-link"
		class:active={isCurrent(resolve('/user'))}
		aria-current={isCurrent(resolve('/user')) ? 'page' : undefined}
		href={resolve('/user')}>用户中心</a
	>
</header>
{#if menuOpen}<button
		class="public-drawer-backdrop"
		type="button"
		aria-label="关闭辅助菜单"
		onclick={() => (menuOpen = false)}
	></button>
	<div
		id="public-mobile-drawer"
		class="public-mobile-drawer"
		role="dialog"
		aria-modal="true"
		aria-label="辅助菜单"
	>
		<div>
			<strong>更多功能</strong><button
				type="button"
				aria-label="关闭辅助菜单"
				onclick={() => (menuOpen = false)}>×</button
			>
		</div>
		<nav>
			{#each auxiliaryLinks as link (link.href)}<a
					href={link.href}
					class:active={isCurrent(link.href)}
					aria-current={isCurrent(link.href) ? 'page' : undefined}
					onclick={() => (menuOpen = false)}>{link.label}</a
				>{/each}
		</nav>
	</div>{/if}
<main class="public-shell">
	<div class="public-canvas">
		<nav class="public-breadcrumb" aria-label="面包屑">
			<a href={resolve('/')}>首页</a><span>/</span><span>{title}</span>
		</nav>
		{#if eyebrow}<p class="public-eyebrow">{eyebrow}</p>{/if}{@render children()}
		<footer class="public-footer public-footer-grid">
			<section>
				<div class="footer-brand">
					<span>N</span><strong>{site().siteName} {site().siteTagline}</strong>
				</div>
				<p>{site().siteDescription}</p>
				<small>把常用入口、内容收藏与热点信息整理成安静可靠的起点。</small>
			</section>
			<section>
				<h2>快捷导航</h2>
				<nav>
					{#each links.slice(0, 4) as link (link.href)}<a href={link.href}>{link.label}</a>{/each}
				</nav>
			</section>
			<section>
				<h2>友情链接</h2>
				<nav>
					<a href={resolve('/contribute')}>申请收录</a><a href={resolve('/hotnews')}>开放热榜</a><a
						href={resolve('/rankings')}>公开排行</a
					><a href={resolve('/robots.txt')}>搜索规则</a>
				</nav>
			</section>
		</footer>
	</div>
</main>
<nav class="mobile-tabbar" aria-label="移动快捷导航">
	{#each tabLinks as link (link.href)}<a
			href={link.href}
			class:active={isCurrent(link.href)}
			aria-current={isCurrent(link.href) ? 'page' : undefined}
			><span>{link.symbol}</span>{link.label}</a
		>{/each}
</nav>
