<script lang="ts">
	import { resolve } from '$app/paths';
	import type { NavigationItem } from '$lib/data/navigation';
	let {
		item,
		compact = false,
		metrics
	}: {
		item: NavigationItem;
		compact?: boolean;
		metrics?: { views: number; favorites: number };
	} = $props();
	let detail = $derived.by(() =>
		item.type === 'site'
			? resolve('/sites/[slug]', { slug: item.slug })
			: item.type === 'post'
				? resolve('/posts/[slug]', { slug: item.slug })
				: item.type === 'app'
					? resolve('/apps/[slug]', { slug: item.slug })
					: item.type === 'book'
						? resolve('/books/[slug]', { slug: item.slug })
						: resolve('/bulletins/[slug]', { slug: item.slug })
	);
	let typeLabel = $derived(
		{ site: '网址', post: '文章', app: '软件', book: '书籍', bulletin: '公告' }[item.type]
	);
	let symbol = $derived({ site: '◎', post: '文', app: '▦', book: '书', bulletin: '告' }[item.type]);
	let mediaId = $derived(
		item.type === 'post' || item.type === 'book'
			? item.coverFileId
			: (item.iconFileId ?? item.coverFileId)
	);
</script>

<article
	class:compact
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
			/>{:else}<span>{symbol}</span>{/if}
	</div>
	<div class="site-content">
		<div class="site-title-row">
			<h3>{item.title}</h3>
			<span class="type-chip">{typeLabel}</span>
		</div>
		<p>{item.summary}</p>
		{#if metrics}<div class="card-metrics">
				<span>浏览 {metrics.views}</span><span>收藏 {metrics.favorites}</span>
			</div>{/if}{#if !compact && item.tags.length}<div class="tag-row">
				{#each item.tags.slice(0, 3) as tag (tag.slug)}<a
						href={resolve('/tags/[slug]', { slug: tag.slug })}>#{tag.name}</a
					>{/each}
			</div>{/if}
	</div>
	<div class="card-actions">
		<a class="detail-link" href={detail} aria-label={`查看 ${item.title} 详情`}>详情</a
		>{#if item.url}<a
				class="direct-link"
				href={resolve(`/go?url=${encodeURIComponent(item.url)}` as '/go')}
				aria-label={`安全访问 ${item.title}`}>↗</a
			>{/if}
	</div>
</article>
