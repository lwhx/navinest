<script lang="ts">
	import HighlightedText from '$lib/components/HighlightedText.svelte';
	import { resolve } from '$app/paths';
	import { contentDetailRoute } from '$lib/content-routing';
	import type { NavigationItem } from '$lib/data/navigation';
	const id = $props.id();
	const hintId = `${id}-description`;
	let {
		item,
		compact = false,
		dense = false,
		metrics,
		highlightQuery = ''
	}: {
		item: NavigationItem;
		compact?: boolean;
		dense?: boolean;
		highlightQuery?: string;
		metrics?: { views: number; favorites: number };
	} = $props();
	let detail = $derived(resolve(contentDetailRoute(item.type), { slug: item.slug }));
	const countFormatter = new Intl.NumberFormat('zh-CN', {
		notation: 'compact',
		maximumFractionDigits: 1
	});
	let mediaId = $derived(
		item.type === 'post' || item.type === 'book'
			? item.coverFileId
			: (item.iconFileId ?? item.coverFileId)
	);
</script>

<article
	class:compact
	class:dense
	class:card-site={item.type === 'site'}
	class:card-post={item.type === 'post'}
	class:card-app={item.type === 'app'}
	class:card-book={item.type === 'book'}
	class:card-bulletin={item.type === 'bulletin'}
	class="site-card benchmark-card differentiated-card"
>
	<div class="site-icon" style={`--accent:${item.accent}`} aria-hidden="true">
		{#if mediaId}<img
				src={resolve('/api/content-files/[id]', { id: String(mediaId) })}
				alt=""
				width="48"
				height="48"
				loading="lazy"
				decoding="async"
			/>{:else}<span
				>{#if item.type === 'site'}<svg
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20M2 12h20" /></svg
					>{:else if item.type === 'post'}<svg
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline
							points="14 2 14 8 20 8"
						/><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg
					>{:else if item.type === 'app'}<svg
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><rect x="3" y="3" width="7" height="7" rx="1" /><rect
							x="14"
							y="3"
							width="7"
							height="7"
							rx="1"
						/><rect x="14" y="14" width="7" height="7" rx="1" /><rect
							x="3"
							y="14"
							width="7"
							height="7"
							rx="1"
						/></svg
					>{:else if item.type === 'book'}<svg
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path
							d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
						/></svg
					>{:else}<svg
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path
							d="M13.73 21a2 2 0 0 1-3.46 0"
						/></svg
					>{/if}</span
			>{/if}
	</div>
	<div class="site-content">
		{#if dense}<a class="card-title-link card-body-link" href={detail} aria-describedby={hintId}>
				<div class="site-title-row">
					<h3><HighlightedText text={item.title} query={highlightQuery} /></h3>
				</div>
				{#if item.summary.trim()}<p class="card-summary">
						<HighlightedText text={item.summary} query={highlightQuery} />
					</p>{/if}
			</a>{:else}<div class="site-title-row">
				<h3>
					<a class="card-title-link" href={detail} aria-describedby={hintId}
						><HighlightedText text={item.title} query={highlightQuery} /></a
					>
				</h3>
			</div>
			{#if item.summary.trim()}<p class="card-summary">
					<HighlightedText text={item.summary} query={highlightQuery} />
				</p>{/if}{/if}
		{#if metrics}<div class="card-secondary">
				<div class="card-metrics">
					<span title={`浏览 ${metrics.views}`}>浏览 {countFormatter.format(metrics.views)}</span
					><span title={`收藏 ${metrics.favorites}`}
						>收藏 {countFormatter.format(metrics.favorites)}</span
					>
				</div>
			</div>{/if}
		{#if !compact && item.tags.length}<div class="tag-row">
				{#each item.tags.slice(0, 3) as tag (tag.slug)}<a
						href={resolve('/tags/[slug]', { slug: tag.slug })}>#{tag.name}</a
					>{/each}
			</div>{/if}
	</div>
	<span class="card-tooltip" id={hintId} role="tooltip"
		><strong>{item.title}</strong>{#if item.summary.trim()}<span>{item.summary}</span>{/if}<small
			>点击标题查看详情；访问箭头在新标签页打开。</small
		></span
	>
	<div class="card-actions">
		<a class="detail-link" href={detail} aria-label={`查看 ${item.title} 详情`}>详情</a
		>{#if item.url}<a
				class="direct-link"
				href={resolve(`/go?url=${encodeURIComponent(item.url)}` as '/go')}
				target="_blank"
				rel="external noopener noreferrer"
				aria-label={`安全访问 ${item.title}（新标签页）`}
				title={`安全访问 ${item.title}（新标签页）`}>↗</a
			>{/if}
	</div>
</article>
