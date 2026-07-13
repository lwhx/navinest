<script lang="ts">
	import { resolve } from '$app/paths';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import { appConfig } from '$lib/config';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let total = $derived(data.sources.reduce((sum, source) => sum + source.items.length, 0));
</script>

<svelte:head
	><title>今日热榜 | {appConfig.displayName}</title><meta
		name="description"
		content="聚合展示 NaviNest 已配置的外部热榜"
	/><link rel="canonical" href={`${appConfig.url}/hotnews`} /><meta
		property="og:title"
		content={`今日热榜 | ${appConfig.displayName}`}
	/><meta property="og:description" content="聚合展示 NaviNest 已配置的外部热榜" /><meta
		property="og:type"
		content="website"
	/><meta property="og:url" content={`${appConfig.url}/hotnews`} /></svelte:head
>
<PublicShell title="今日热榜" eyebrow="Hot News"
	><header class="listing-hero hotnews-hero">
		<div>
			<span>实时聚合</span>
			<h1>今日热榜</h1>
			<p>聚合已启用的JSON与RSS信息源，外链统一经过安全检查。</p>
		</div>
		<strong>{total}<small>热点条目</small></strong>
	</header>
	{#if data.sources.length}<div class="hot-source-grid">
			{#each data.sources as source (source.id)}<section class="hot-source-card">
					<header>
						<div>
							<span>{source.type.toUpperCase()}</span>
							<h2>{source.name}</h2>
						</div>
						{#if source.lastFetchAt}<time>{source.lastFetchAt}</time>{/if}
					</header>
					{#if source.items.length}<ol>
							{#each source.items as item (item.rank)}<li>
									<span class="hot-rank">{item.rank}</span>
									<div>
										<a href={resolve(`/go?url=${encodeURIComponent(item.url)}` as '/go')}
											>{item.title}</a
										>{#if item.extra?.description}<p>{String(item.extra.description)}</p>{/if}
									</div>
									{#if item.hotValue}<strong>{item.hotValue}</strong>{/if}
								</li>{/each}
						</ol>{:else}<div class="empty-state">
							<strong>正在等待首次刷新</strong>
							<p>该来源会在管理员刷新或下次定时任务后显示内容。</p>
						</div>{/if}
				</section>{/each}
		</div>{:else}<div class="empty-state">
			<strong>暂时没有热榜来源</strong>
			<p>管理员配置并启用JSON或RSS来源后，内容会显示在这里。</p>
			<a class="primary-action" href={resolve('/')}>返回首页</a>
		</div>{/if}</PublicShell
>
