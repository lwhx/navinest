<script lang="ts">
	import type { Snippet } from 'svelte';
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
</script>

<header class="public-header">
	<button
		class="public-menu-button"
		type="button"
		aria-label="打开页面菜单"
		aria-expanded={menuOpen}
		aria-controls="public-mobile-drawer"
		onclick={() => (menuOpen = !menuOpen)}>☰</button
	><a class="public-logo" href={resolve('/')}><span>N</span><strong>{site().siteName}</strong></a>
	<nav aria-label="主导航">
		{#each links as link (link.href)}<a href={link.href}>{link.label}</a>{/each}
	</nav>
	<a class="public-user-link" href={resolve('/user')}>用户中心</a>
</header>
{#if menuOpen}<button
		class="public-drawer-backdrop"
		type="button"
		aria-label="关闭页面菜单"
		onclick={() => (menuOpen = false)}
	></button>
	<aside id="public-mobile-drawer" class="public-mobile-drawer">
		<div>
			<strong>页面导航</strong><button
				type="button"
				aria-label="关闭页面菜单"
				onclick={() => (menuOpen = false)}>×</button
			>
		</div>
		<nav>
			{#each links as link (link.href)}<a href={link.href} onclick={() => (menuOpen = false)}
					>{link.label}</a
				>{/each}
		</nav>
	</aside>{/if}
<main class="public-shell">
	<aside class="public-sidebar">
		<div class="public-sidebar-brand">
			<span>N</span><strong>{site().siteName} {site().siteTagline}</strong>
		</div>
		<nav>
			{#each links as link (link.href)}<a href={link.href}>{link.label}</a>{/each}
		</nav>
	</aside>
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
	<a href={resolve('/')}><span>⌂</span>首页</a><a href={resolve('/search')}><span>⌕</span>搜索</a><a
		href={resolve('/rankings')}><span>榜</span>排行</a
	><a href={resolve('/hotnews')}><span>热</span>热点</a><a href={resolve('/user')}
		><span>我</span>我的</a
	>
</nav>
