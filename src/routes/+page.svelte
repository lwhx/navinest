<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import HomeModuleFlow from '$lib/components/HomeModuleFlow.svelte';
	import { appConfig } from '$lib/config';
	import { buildHomeCategoryLinks, trackHomeCategories } from '$lib/home-category-navigation';
	import { modalDrawer } from '$lib/ui-actions';
	import './home-reference.css';
	import '$lib/components/public-navigation.css';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let activeCategory = $state(''),
		mobileMenuOpen = $state(false);
	let categoryLinks = $derived(buildHomeCategoryLinks(data.modulePlan, data.sections));
	onMount(() => trackHomeCategories((slug) => (activeCategory = slug)));

	function closeMenuOnEscape(event: KeyboardEvent) {
		if (event.key === 'Escape') mobileMenuOpen = false;
	}

	$effect(() => {
		if (!mobileMenuOpen) return;
		const documentOverflow = document.documentElement.style.overflow;
		const bodyOverflow = document.body.style.overflow;
		document.documentElement.style.overflow = 'hidden';
		document.body.style.overflow = 'hidden';
		return () => {
			document.documentElement.style.overflow = documentOverflow;
			document.body.style.overflow = bodyOverflow;
		};
	});
	const categorySymbols: Record<string, string> = {
		favorites: '★',
		'dev-tools': '</>',
		design: '◇',
		productivity: '✓',
		books: '▤',
		posts: '✎',
		bulletins: '!'
	};
	const tabLinks = [
		{ label: '首页', symbol: '⌂', href: resolve('/') },
		{ label: '搜索', symbol: '⌕', href: resolve('/search') },
		{ label: '排行', symbol: '榜', href: resolve('/rankings') },
		{ label: '热点', symbol: '热', href: resolve('/hotnews') },
		{ label: '我的', symbol: '我', href: resolve('/user') }
	];
</script>

<svelte:window onkeydown={closeMenuOnEscape} />

<svelte:head
	><title>{`${data.site.siteName} ${data.site.siteTagline}`}</title><meta
		name="description"
		content={data.site.siteDescription}
	/><link rel="canonical" href={appConfig.url} /><meta
		property="og:title"
		content={`${data.site.siteName} ${data.site.siteTagline}`}
	/><meta property="og:description" content={data.site.siteDescription} /><meta
		property="og:type"
		content="website"
	/><meta property="og:url" content={appConfig.url} /></svelte:head
>
<header class="home-header">
	<button
		class="mobile-menu-button"
		type="button"
		aria-label="打开分类菜单"
		aria-controls="mobile-drawer"
		aria-expanded={mobileMenuOpen}
		onclick={() => (mobileMenuOpen = !mobileMenuOpen)}>☰</button
	><a class="home-logo" href={resolve('/')}><span>N</span><strong>{appConfig.name}</strong></a>
	<nav aria-label="主导航">
		<a href={resolve('/')} aria-current="page">首页</a><a href={resolve('/contribute')}>投稿收录</a
		><a href={resolve('/rankings')}>排行榜</a><a href={resolve('/hotnews')}>今日热点</a>
	</nav>
	<div class="home-header-actions">
		{#if data.user}<a class="user-pill" href={resolve('/user')}>{data.user.displayName}</a>{:else}<a
				class="user-pill"
				href={resolve('/login')}>登录</a
			>{/if}
	</div>
</header>
{#if mobileMenuOpen}<button
		class="mobile-drawer-backdrop"
		data-drawer-backdrop
		type="button"
		aria-label="关闭分类菜单"
		onclick={() => (mobileMenuOpen = false)}
	></button>
	<div
		id="mobile-drawer"
		class="mobile-drawer"
		role="dialog"
		aria-modal="true"
		aria-label="分类导航"
		use:modalDrawer={() => (mobileMenuOpen = false)}
	>
		<div class="mobile-drawer-header">
			<strong>分类导航</strong><button
				type="button"
				aria-label="关闭分类菜单"
				onclick={() => (mobileMenuOpen = false)}>×</button
			>
		</div>
		<nav>
			{#each categoryLinks as category (category.slug)}<a
					href={`#${category.slug}`}
					class:active={activeCategory === category.slug}
					aria-current={activeCategory === category.slug ? 'location' : undefined}
					onclick={() => (mobileMenuOpen = false)}
					><span class="nav-symbol">{categorySymbols[category.slug] ?? '•'}</span>{category.name}</a
				>{/each}
		</nav>
	</div>{/if}
<main class="home-page">
	<HomeModuleFlow home={data} mode="hero" />
	<div class="home-shell">
		<aside class="home-sidebar" aria-label="分类导航">
			<div class="sidebar-brand">
				<span>N</span>
				<div><strong>{appConfig.displayName}</strong><small>{appConfig.tagline}</small></div>
			</div>
			<nav>
				{#each categoryLinks as category (category.slug)}<a
						href={`#${category.slug}`}
						class:active={activeCategory === category.slug}
						aria-current={activeCategory === category.slug ? 'location' : undefined}
						><span class="nav-symbol">{categorySymbols[category.slug] ?? '•'}</span><span
							>{category.name}</span
						></a
					>{/each}
			</nav>
			<div class="sidebar-shortcuts">
				<a href={resolve('/search')}>站内搜索</a><a href={resolve('/user')}>我的导航</a>
			</div>
		</aside>
		<div class="home-canvas">
			<div class="home-content-layout">
				<HomeModuleFlow home={data} mode="content" />
				<aside class="home-right-rail" aria-label="站点数据">
					<section class="rail-card site-summary">
						<div class="rail-brand">N</div>
						<h2>{appConfig.displayName}</h2>
						<p>{appConfig.tagline}</p>
						<div class="site-stats">
							<div><strong>{data.dashboard.stats.items}</strong><span>收录内容</span></div>
							<div><strong>{data.dashboard.stats.categories}</strong><span>分类</span></div>
							<div><strong>{data.dashboard.stats.users}</strong><span>用户</span></div>
						</div>
					</section>
					<section class="rail-card">
						<div class="rail-title">
							<h2>今日热榜</h2>
							<a href={resolve('/hotnews')}>更多</a>
						</div>
						{#if data.dashboard.hotnews.length}<ol class="rail-list">
								{#each data.dashboard.hotnews.slice(0, 5) as item (`${item.source}-${item.rank}`)}<li
									>
										<span>{item.rank}</span><a
											href={resolve(`/go?url=${encodeURIComponent(item.url)}` as '/go')}
											target="_blank"
											rel="external noopener noreferrer">{item.title}</a
										>
									</li>{/each}
							</ol>{:else}<p class="rail-empty">等待热榜刷新</p>{/if}
					</section>
					<section class="rail-card">
						<div class="rail-title">
							<h2>排行榜</h2>
							<a href={resolve('/rankings')}>更多</a>
						</div>
						<ol class="rail-list">
							{#each data.dashboard.popular.slice(0, 5) as item (`${item.type}-${item.slug}`)}<li>
									<span>{item.score}</span><a href={resolve('/rankings')}>{item.title}</a>
								</li>{/each}
						</ol>
					</section>
				</aside>
			</div>
		</div>
	</div>
	<div class="home-anchor-spacer" aria-hidden="true"></div>
	<footer class="home-footer">
		<span>© {new Date().getFullYear()} {appConfig.displayName}</span>
		<nav aria-label="页脚导航">
			<a href={resolve('/search')}>搜索</a><a href={resolve('/rankings')}>排行</a><a
				href={resolve('/hotnews')}>热点</a
			>
		</nav>
	</footer>
</main>
<nav class="mobile-tabbar" aria-label="移动快捷导航">
	{#each tabLinks as link (link.href)}<a
			href={link.href}
			class:active={link.href === resolve('/')}
			aria-current={link.href === resolve('/') ? 'page' : undefined}
			><span>{link.symbol}</span>{link.label}</a
		>{/each}
</nav>
