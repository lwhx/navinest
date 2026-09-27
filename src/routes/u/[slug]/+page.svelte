<script lang="ts">
	import { resolve } from '$app/paths';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import { siteDisplayName } from '$lib/types/site';
	import { useSiteSettings } from '$lib/site-context';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const site = useSiteSettings();
	const title = $derived(`${data.share.owner.displayName} 的导航`);

	function host(url: string) {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	}
</script>

<svelte:head>
	<title>{title} | {siteDisplayName(site())}</title>
	<meta
		name="description"
		content={`${data.share.owner.displayName} 在 ${siteDisplayName(site())} 上分享的 ${data.share.total} 个入口。`}
	/>
	<meta property="og:title" content={title} />
	<meta property="og:type" content="website" />
</svelte:head>

<PublicShell {title} eyebrow="SHARED NAVIGATION">
	<section class="share-intro">
		<h1>{data.share.owner.displayName} 的导航</h1>
		<p>
			由 @{data.share.owner.username} 分享的 {data.share.total} 个入口，共 {data.share.groups
				.length} 组。
		</p>
	</section>
	{#each data.share.groups as group (group.id ?? 'uncategorized')}
		<section class="share-group" aria-labelledby={`share-group-${group.id ?? 'none'}`}>
			<h2 id={`share-group-${group.id ?? 'none'}`}>{group.name ?? '未分类'}</h2>
			<ul class="share-links">
				{#each group.links as link (link.id)}
					<li>
						<a
							href={resolve(`/go?url=${encodeURIComponent(link.url)}` as '/go')}
							target="_blank"
							rel="external noopener noreferrer"
						>
							<strong>{link.title}</strong>
							{#if link.summary}<span>{link.summary}</span>{/if}
							<small>{host(link.url)}</small>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
	{#if !data.share.groups.length}
		<p class="share-empty">这位用户还没有公开任何入口。</p>
	{/if}
</PublicShell>

<style>
	.share-intro {
		margin-bottom: 18px;
	}

	.share-intro h1 {
		margin: 0 0 6px;
	}

	.share-intro p {
		margin: 0;
		color: #7b8087;
	}

	.share-group {
		margin-bottom: 20px;
	}

	.share-group h2 {
		margin: 0 0 10px;
		font-size: 16px;
	}

	.share-links {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.share-links a {
		display: grid;
		gap: 4px;
		padding: 12px 14px;
		border: 1px solid #e4e7eb;
		border-radius: 12px;
		background: #fbfcfd;
		color: inherit;
		text-decoration: none;
	}

	.share-links a:hover {
		border-color: #c9d3e0;
	}

	.share-links strong {
		font-size: 14px;
	}

	.share-links span {
		color: #5f646b;
		font-size: 12px;
	}

	.share-links small {
		color: #8b8f95;
		font-size: 11px;
	}

	.share-empty {
		color: #7b8087;
	}
</style>
