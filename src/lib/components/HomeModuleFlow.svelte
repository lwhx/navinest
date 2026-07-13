<script lang="ts">
	import { resolve } from '$app/paths';
	import NavigationCard from './NavigationCard.svelte';
	import type { HomeData } from '$lib/server/services/home';
	let { home }: { home: HomeData } = $props();
	let query = $state(''),
		engineKey = $state<string | null>(null);
	let engine = $derived(
		home.searchEngines.find((x) => x.key === engineKey) ?? home.searchEngines[0]
	);
	let all = $derived(home.sections.flatMap((x) => x.items));
	let popular = $derived(
		home.dashboard.popular.map((metrics) => ({
			metrics,
			item: all.find((x) => x.slug === metrics.slug && x.type === metrics.type)
		}))
	);
	const words = ['AI 工具', '设计资源', '开发工具', '效率软件'];
	function search() {
		const value = query.trim();
		if (value && engine)
			location.href = engine.urlTemplate.replace('{query}', encodeURIComponent(value));
	}
</script>

<div class="home-module-flow category-sections">
	{#each home.modulePlan as module (module.key)}
		{#if module.type === 'search'}<section class="search-hero" aria-label={module.title}>
				<div class="search-core">
					<div class="search-kicker">探索、收藏并整理互联网</div>
					<h1>今天想找点什么？</h1>
					<div class="engine-tabs">
						{#each home.searchEngines as item (item.key)}<button
								type="button"
								class:active={item.key === engine.key}
								onclick={() => (engineKey = item.key)}>{item.name}</button
							>{/each}
					</div>
					<form
						class="hero-search-form"
						onsubmit={(e) => {
							e.preventDefault();
							search();
						}}
					>
						<span aria-hidden="true">⌕</span><input
							bind:value={query}
							aria-label={`${engine?.name ?? '站内'}搜索`}
							placeholder={`使用 ${engine?.name ?? '站内'} 搜索`}
						/><button type="submit">搜索</button>
					</form>
					<div class="search-hotwords">
						<span>热门：</span>{#each words as word (word)}<button
								type="button"
								onclick={() => {
									query = word;
									search();
								}}>{word}</button
							>{/each}
					</div>
				</div>
				<div class="hero-links">
					<strong>热门</strong><a href={resolve('/rankings')}>本周排行榜</a><a
						href={resolve('/hotnews')}>今日热点</a
					><a href={resolve('/contribute')}>立即投稿</a>
				</div>
			</section>
		{:else if module.type === 'ranking'}<section
				class="popular-sites"
				aria-labelledby={`module-${module.key}`}
			>
				<div class="module-title">
					<div>
						<span class="module-icon">★</span>
						<h2 id={`module-${module.key}`}>{module.title}</h2>
					</div>
					<a href={resolve('/rankings')}>完整榜单</a>
				</div>
				<div class="popular-grid">
					{#each popular as entry (`${entry.metrics.type}-${entry.metrics.slug}`)}{#if entry.item}<NavigationCard
								item={entry.item}
								compact
								metrics={{ views: entry.metrics.views, favorites: entry.metrics.favorites }}
							/>{/if}{/each}
				</div>
			</section>
		{:else if module.type === 'content'}{@const section = home.sections.find(
				(x) => x.slug === module.categorySlug
			)}{#if section}<section
					class="category-module"
					id={section.slug}
					data-category-section
					aria-labelledby={`${section.slug}-heading`}
				>
					<div class="module-title">
						<div>
							<span class="module-icon">{section.name.slice(0, 1)}</span>
							<h2 id={`${section.slug}-heading`}>{module.title}</h2>
							{#if section.children.length}<nav
									class="subcategory-tabs"
									aria-label={`${section.name}子分类`}
								>
									{#each section.children as child (child.slug)}<a
											href={resolve('/categories/[slug]', { slug: child.slug })}>{child.name}</a
										>{/each}
								</nav>{/if}
						</div>
						<a href={resolve('/categories/[slug]', { slug: section.slug })}>more+</a>
					</div>
					{#if section.items.length}<div class="site-grid">
							{#each section.items as item (item.slug)}<NavigationCard {item} />{/each}
						</div>{:else}<p class="inline-empty">此分类暂时没有内容。</p>{/if}
				</section>{/if}
		{:else if module.type === 'hot'}<section class="category-module">
				<div class="module-title">
					<div>
						<span class="module-icon">热</span>
						<h2>{module.title}</h2>
					</div>
					<a href={resolve('/hotnews')}>more+</a>
				</div>
				<ol class="home-hot-list">
					{#each home.dashboard.hotnews.slice(0, 10) as item (`${item.source}-${item.rank}`)}<li>
							<span>{item.rank}</span><a
								href={resolve(`/go?url=${encodeURIComponent(item.url)}` as '/go')}>{item.title}</a
							>
						</li>{/each}
				</ol>
			</section>
		{:else if module.type === 'links'}<section class="category-module">
				<div class="module-title">
					<div>
						<span class="module-icon">链</span>
						<h2>{module.title}</h2>
					</div>
				</div>
				<div class="home-links-grid">
					{#each module.links ?? [] as link (link.url)}{#if link.url.startsWith('/')}<a
								href={resolve(link.url as '/')}>{link.label}</a
							>{:else}<a href={resolve(`/go?url=${encodeURIComponent(link.url)}` as '/go')}
								>{link.label}</a
							>{/if}{/each}
				</div>
			</section>{/if}
	{/each}
</div>
