<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import HomeModuleFlow from '$lib/components/HomeModuleFlow.svelte';
	import { appConfig } from '$lib/config';
	import './home-reference.css';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let activeCategory = $state(''),
		mobileMenuOpen = $state(false);
	onMount(() => {
		const sections = [...document.querySelectorAll<HTMLElement>('[data-category-section]')];
		if (!sections.length) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((x) => x.isIntersecting)
					.sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
				if (visible?.target.id) activeCategory = visible.target.id;
			},
			{ rootMargin: '-20% 0px -65%', threshold: [0, 0.25, 0.5] }
		);
		sections.forEach((x) => observer.observe(x));
		activeCategory = sections[0].id;
		return () => observer.disconnect();
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
</script>

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
		<a href={resolve('/')}>首页</a><a href={resolve('/contribute')}>投稿收录</a><a
			href={resolve('/rankings')}>排行榜</a
		><a href={resolve('/hotnews')}>今日热点</a>
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
		type="button"
		aria-label="关闭分类菜单"
		onclick={() => (mobileMenuOpen = false)}
	></button>
	<aside id="mobile-drawer" class="mobile-drawer" aria-label="移动分类导航">
		<div class="mobile-drawer-header">
			<strong>分类导航</strong><button
				type="button"
				aria-label="关闭分类菜单"
				onclick={() => (mobileMenuOpen = false)}>×</button
			>
		</div>
		<nav>
			{#each data.categories.filter((x) => !x.parentId) as category (category.slug)}<a
					href={`#${category.slug}`}
					onclick={() => (mobileMenuOpen = false)}
					><span class="nav-symbol">{categorySymbols[category.slug] ?? '•'}</span>{category.name}</a
				>{/each}
		</nav>
	</aside>{/if}
<main class="home-page">
	<HomeModuleFlow home={data} mode="hero" />
	<div class="home-shell">
		<aside class="home-sidebar" aria-label="分类导航">
			<div class="sidebar-brand">
				<span>N</span>
				<div><strong>{appConfig.displayName}</strong><small>{appConfig.tagline}</small></div>
			</div>
			<nav>
				{#each data.categories.filter((x) => !x.parentId) as category (category.slug)}<a
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
	<footer class="home-footer">
		<span>© {new Date().getFullYear()} {appConfig.displayName}</span>
		<nav aria-label="页脚导航">
			<a href={resolve('/search')}>搜索</a><a href={resolve('/rankings')}>排行</a><a
				href={resolve('/hotnews')}>热点</a
			>
		</nav>
	</footer>
</main>
