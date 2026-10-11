<script lang="ts">
	import { contentDetailRoute, contentTypeLabels } from '$lib/content-routing';
	import { resolve } from '$app/paths';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import { appConfig } from '$lib/config';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const periods = [
		['day', '日榜'],
		['week', '周榜'],
		['month', '月榜'],
		['total', '总榜']
	] as const;
</script>

<svelte:head
	><title>排行榜 | {appConfig.displayName}</title><meta
		name="description"
		content="NaviNest 日榜、周榜、月榜和总榜"
	/><link rel="canonical" href={`${appConfig.url}/rankings`} /><meta
		property="og:title"
		content={`排行榜 | ${appConfig.displayName}`}
	/><meta property="og:description" content="NaviNest 日榜、周榜、月榜和总榜" /><meta
		property="og:type"
		content="website"
	/><meta property="og:url" content={`${appConfig.url}/rankings`} /></svelte:head
>
<PublicShell title="排行榜" eyebrow="Ranking"
	><header class="listing-hero ranking-hero">
		<div>
			<span>真实访问数据</span>
			<h1>内容排行榜</h1>
			<p>按浏览与收藏统计生成日榜、周榜、月榜和总榜。</p>
		</div>
		<strong>{data.items.length}<small>上榜内容</small></strong>
	</header>
	<nav class="ranking-periods" aria-label="排行榜周期">
		{#each periods as [value, label] (value)}<a
				class:active={data.period === value}
				href={resolve(`/rankings?period=${value}` as '/')}>{label}</a
			>{/each}
	</nav>
	{#if data.items.length}<ol class="ranking-list">
			{#each data.items as item, index (item.id)}<li>
					<span class="ranking-number">{index + 1}</span>
					<div>
						<a
							class="ranking-title"
							href={resolve(contentDetailRoute(item.type), { slug: item.slug })}>{item.title}</a
						><small>{contentTypeLabels[item.type]}</small>
					</div>
					<div class="ranking-metrics">
						<span><strong>{item.score}</strong>综合分</span><span
							><strong>{item.views}</strong>浏览</span
						><span><strong>{item.favorites}</strong>收藏</span>
					</div>
				</li>{/each}
		</ol>{:else}<div class="empty-state">
			<strong>当前周期暂无排行</strong>
			<p>浏览和收藏公开内容后，统计会自动出现在这里。</p>
			<a class="primary-action" href={resolve('/')}>浏览首页内容</a>
		</div>{/if}</PublicShell
>
