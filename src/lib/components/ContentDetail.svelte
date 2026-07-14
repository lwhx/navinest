<script lang="ts">
	import { resolve } from '$app/paths';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import { appConfig } from '$lib/config';
	import type { ContentDetailData } from '$lib/server/services/content-detail';
	let { data }: { data: ContentDetailData & { isFavorite: boolean } } = $props();
	let favorite = $derived(data.isFavorite),
		savingFavorite = $state(false);
	async function toggleFavorite() {
		if (data.id === null || savingFavorite) return;
		savingFavorite = true;
		const response = await fetch(`/api/user/favorites/${data.id}`, {
			method: favorite ? 'DELETE' : 'PUT'
		});
		if (response.status === 401) {
			location.href = resolve('/login');
			return;
		}
		if (response.ok) favorite = !favorite;
		savingFavorite = false;
	}
	const typeLabels = {
			site: '网址',
			post: '文章',
			app: '应用',
			book: '书籍影视',
			bulletin: '公告'
		},
		symbols = { site: '◎', post: '文', app: '▦', book: '书', bulletin: '告' };
	const metaLabels: Record<string, string> = {
		app_platform: '支持平台',
		book_author: '作者',
		book_score: '评分',
		site_type: '网址类型'
	};
	let facts = $derived(
		Object.entries(data.meta)
			.filter(([key, value]) => Boolean(metaLabels[key] && value))
			.map(([key, value]) => ({ label: metaLabels[key], value }))
	);
	function detailPath() {
		const slug = encodeURIComponent(data.slug);
		return data.type === 'site'
			? `/sites/${slug}`
			: data.type === 'post'
				? `/posts/${slug}`
				: data.type === 'app'
					? `/apps/${slug}`
					: data.type === 'book'
						? `/books/${slug}`
						: `/bulletins/${slug}`;
	}
	function schemaType() {
		return data.type === 'post' || data.type === 'bulletin'
			? 'Article'
			: data.type === 'app'
				? 'SoftwareApplication'
				: data.type === 'book'
					? 'Book'
					: 'WebSite';
	}
	let canonical = $derived(`${appConfig.url}${detailPath()}`),
		jsonLd = $derived(
			JSON.stringify({
				'@context': 'https://schema.org',
				'@type': schemaType(),
				name: data.title,
				description: data.summary,
				url: canonical,
				...(data.externalUrl ? { sameAs: data.externalUrl } : {})
			}).replace(/</g, '\\u003c')
		);
</script>

<svelte:head
	><title>{data.title} | {appConfig.displayName}</title><meta
		name="description"
		content={data.summary}
	/><link rel="canonical" href={canonical} /><meta property="og:title" content={data.title} /><meta
		property="og:description"
		content={data.summary}
	/><meta
		property="og:type"
		content={data.type === 'post' || data.type === 'bulletin' ? 'article' : 'website'}
	/><meta property="og:url" content={canonical} /><meta name="twitter:card" content="summary" />
	<!-- jsonLd escapes '<' before insertion so content cannot close the script element. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html '<script type="application/ld+json">' + jsonLd + '<' + '/script>'}
</svelte:head>
<PublicShell title={data.title} eyebrow={typeLabels[data.type]}
	><article
		class:detail-site={data.type === 'site'}
		class:detail-post={data.type === 'post'}
		class:detail-app={data.type === 'app'}
		class:detail-book={data.type === 'book'}
		class:detail-bulletin={data.type === 'bulletin'}
		class="product-detail"
	>
		<header class="product-detail-hero">
			<div class="detail-type-symbol">{symbols[data.type]}</div>
			<div>
				<span>{typeLabels[data.type]}</span>
				<h1>{data.title}</h1>
				<p>{data.summary}</p>
				<div class="detail-taxonomy">
					{#if data.category}<a href={resolve('/categories/[slug]', { slug: data.category.slug })}
							>{data.category.name}</a
						>{/if}{#each data.tags as tag (tag.slug)}<a
							href={resolve('/tags/[slug]', { slug: tag.slug })}>#{tag.name}</a
						>{/each}
				</div>
			</div>
			<div class="detail-actions">
				{#if data.id !== null}<button
						type="button"
						onclick={toggleFavorite}
						disabled={savingFavorite}>{favorite ? '取消收藏' : '收藏'}</button
					>{/if}{#if data.externalUrl}<a
						href={resolve(`/go?url=${encodeURIComponent(data.externalUrl)}` as '/go')}
						target="_blank"
						rel="external noopener noreferrer">访问外部页面</a
					>{/if}
			</div>
		</header>
		<div class="detail-layout">
			<div class="detail-main">
				{#if data.content}<section class="detail-content" aria-label="内容">
						<h2>{data.type === 'post' || data.type === 'bulletin' ? '正文内容' : '详细介绍'}</h2>
						<p>{data.content}</p>
					</section>{:else}<section class="detail-content">
						<h2>详细介绍</h2>
						<p>{data.summary}</p>
					</section>{/if}
			</div>
			<aside class="detail-side">
				<h2>内容信息</h2>
				<dl>
					<div>
						<dt>类型</dt>
						<dd>{typeLabels[data.type]}</dd>
					</div>
					{#if data.category}<div>
							<dt>分类</dt>
							<dd>{data.category.name}</dd>
						</div>{/if}{#each facts as fact (fact.label)}<div>
							<dt>{fact.label}</dt>
							<dd>{fact.value}</dd>
						</div>{/each}
				</dl>
			</aside>
		</div>
	</article></PublicShell
>
