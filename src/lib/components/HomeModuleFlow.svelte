<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { readHomeSubcategories, homeSubcategoryUrl } from '$lib/home-subcategory-state';
	import { normalizeSearchQuery } from '$lib/search';
	import { searchSourcePreview, INTERNAL_SEARCH_TEMPLATE } from '$lib/search-source';
	import {
		readSearchEnginePreference,
		saveSearchEnginePreference
	} from '$lib/search-engine-preference';
	import NavigationCard from './NavigationCard.svelte';
	import SearchForm from './SearchForm.svelte';
	import type { NavigationItem } from '$lib/data/navigation';
	import type { HomeData } from '$lib/server/services/home';
	let { home, mode }: { home: HomeData; mode: 'hero' | 'content' } = $props();
	let query = $state(''),
		engineKey = $state<string | null>(null);
	let activeSubcategories = $derived(
		readHomeSubcategories(
			page.url,
			home.sections.filter((section) =>
				home.modulePlan.some(
					(module) => module.type === 'content' && module.categorySlug === section.slug
				)
			)
		)
	);
	let engine = $derived(
		home.searchEngines.find((x) => x.key === engineKey) ??
			home.searchEngines[0] ?? {
				name: '站内',
				key: 'site',
				urlTemplate: '/search?q={query}',
				placeholder: null
			}
	);
	onMount(() => {
		engineKey = readSearchEnginePreference(home.searchEngines.map((item) => item.key));
	});
	let all = $derived(home.sections.flatMap((x) => x.items));
	let popular = $derived(
		home.dashboard.popular.map((metrics) => ({
			metrics,
			item:
				all.find((x) => x.slug === metrics.slug && x.type === metrics.type) ??
				({
					type: metrics.type,
					slug: metrics.slug,
					title: metrics.title,
					summary: '',
					url: null,
					category: '',
					tags: [],
					accent: '#64748b'
				} satisfies NavigationItem)
		}))
	);
	let modules = $derived(
		mode === 'hero'
			? home.modulePlan.filter((module) => module.type === 'search')
			: home.modulePlan.filter((module) => module.type !== 'search')
	);
	function chooseEngine(key: string) {
		engineKey = key;
		saveSearchEnginePreference(key);
	}
	function search() {
		const value = normalizeSearchQuery(query);
		if (value) {
			const preview = searchSourcePreview(engine.urlTemplate, value);
			const target = preview.valid
				? preview.target
				: INTERNAL_SEARCH_TEMPLATE.replace('{query}', encodeURIComponent(value));
			location.href = target.startsWith('/') ? resolve(target as '/search') : target;
		}
	}
	function selectSubcategory(event: MouseEvent, sectionSlug: string, childSlug: string | null) {
		// Keep native links for opening a new tab and for browsers without JavaScript.
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		event.preventDefault();
		const target = resolve(`/${homeSubcategoryUrl(page.url, sectionSlug, childSlug)}` as '/');
		if (new URL(target, page.url).search === page.url.search) return;
		// The homepage loaders do not depend on query parameters, so Kit reuses their data.
		void goto(target, { keepFocus: true, noScroll: true });
	}
</script>

<div
	class:home-hero-flow={mode === 'hero'}
	class:home-module-flow={mode === 'content'}
	class="category-sections"
>
	{#each modules as module (module.key)}
		{#if module.type === 'search'}<section class="search-hero" aria-label={module.title}>
				<div class="search-core">
					<div class="search-kicker">探索、收藏并整理互联网</div>
					<h1>今天想找点什么？</h1>
					<div class="engine-tabs" role="group" aria-label="选择搜索引擎">
						{#each home.searchEngines as item (item.key)}<button
								type="button"
								class:active={item.key === engine.key}
								aria-pressed={item.key === engine.key}
								onclick={() => chooseEngine(item.key)}>{item.name}</button
							>{/each}
					</div>
					<noscript><p>未启用 JavaScript，搜索将使用站内搜索。</p></noscript>
					<SearchForm
						bind:value={query}
						variant="hero"
						label={`${engine?.name ?? '站内'}搜索`}
						placeholder={engine.placeholder?.trim() || `使用 ${engine?.name ?? '站内'} 搜索`}
						onSearch={search}
					/>
					{#if module.recommendedSearches?.length}<div class="search-hotwords">
							<span>推荐搜索：</span>
							<div class="search-recommendations" role="group" aria-label="推荐搜索词">
								{#each module.recommendedSearches as word (word)}<button
										type="button"
										title={word}
										onclick={() => {
											query = word;
											search();
										}}>{word}</button
									>{/each}
							</div>
						</div>{/if}
				</div>
				<div class="hero-links">
					<strong>快捷入口</strong><a href={resolve('/rankings')}>本周排行榜</a><a
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
					<a href={resolve('/rankings')}>更多</a>
				</div>
				{#if popular.length}<div class="popular-grid">
						{#each popular as entry (`${entry.metrics.type}-${entry.metrics.slug}`)}<NavigationCard
								item={entry.item}
								compact
								dense
							/>{/each}
					</div>{:else}<div class="inline-empty">
						<p>暂无排行内容。</p>
						<a href={resolve('/rankings')}>查看全部</a>
					</div>{/if}
			</section>
		{:else if module.type === 'content'}{@const section = home.sections.find(
				(x) => x.slug === module.categorySlug
			)}{#if section}{@const activeChild =
					activeSubcategories[section.slug]}{@const activeChildName = section.children.find(
					(child) => child.slug === activeChild
				)?.name}{@const visibleItems = activeChildName
					? (section.itemsByChild?.[activeChild ?? ''] ??
						section.items.filter((item) => item.category === activeChildName))
					: section.items}
				<section
					class="category-module"
					id={section.slug}
					data-category-section
					aria-labelledby={`${section.slug}-heading`}
				>
					<div class="module-title">
						<div>
							<span class="module-icon">{section.name.slice(0, 1)}</span>
							<h2 id={`${section.slug}-heading`}>{module.title}</h2>
							{#if section.children.length}<div
									class="subcategory-tabs"
									data-sveltekit-preload-data="off"
									role="tablist"
									aria-label={`${section.name}子分类`}
								>
									<a
										href={resolve(`/${homeSubcategoryUrl(page.url, section.slug, null)}` as '/')}
										role="tab"
										class:active={!activeChild}
										aria-selected={!activeChild}
										onclick={(event) => selectSubcategory(event, section.slug, null)}>全部</a
									>{#each section.children as child (child.slug)}<a
											href={resolve(
												`/${homeSubcategoryUrl(page.url, section.slug, child.slug)}` as '/'
											)}
											role="tab"
											class:active={activeChild === child.slug}
											aria-selected={activeChild === child.slug}
											onclick={(event) => selectSubcategory(event, section.slug, child.slug)}
											>{child.name}</a
										>{/each}
								</div>{/if}
						</div>
						<a href={resolve('/categories/[slug]', { slug: section.slug })}>更多</a>
					</div>
					{#if visibleItems.length}<div class="site-grid" aria-live="polite">
							{#each visibleItems as item (item.slug)}<NavigationCard {item} compact dense />{/each}
						</div>{:else}<div class="inline-empty" aria-live="polite">
							<p>此分类暂时没有内容。</p>
							<a href={resolve('/search')}>搜索其他资源</a>
						</div>{/if}
				</section>{/if}
		{:else if module.type === 'hot'}<section class="category-module">
				<div class="module-title">
					<div>
						<span class="module-icon">热</span>
						<h2>{module.title}</h2>
					</div>
					<a href={resolve('/hotnews')}>更多</a>
				</div>
				{#if home.dashboard.hotnews.length}<ol class="home-hot-list">
						{#each home.dashboard.hotnews.slice(0, 10) as item (`${item.source}-${item.rank}`)}<li>
								<span>{item.rank}</span><a
									href={resolve(`/go?url=${encodeURIComponent(item.url)}` as '/go')}
									target="_blank"
									rel="external noopener noreferrer">{item.title}</a
								>
							</li>{/each}
					</ol>{:else}<div class="inline-empty">
						<p>等待热点更新。</p>
						<a href={resolve('/hotnews')}>查看全部</a>
					</div>{/if}
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
							>{:else}<a
								href={resolve(`/go?url=${encodeURIComponent(link.url)}` as '/go')}
								target="_blank"
								rel="external noopener noreferrer">{link.label}</a
							>{/if}{/each}
				</div>
			</section>{/if}
	{/each}
</div>
