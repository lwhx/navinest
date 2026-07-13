<script lang="ts">
	import PublicShell from '$lib/components/PublicShell.svelte';
	import ContentResults from '$lib/components/ContentResults.svelte';
	import { appConfig } from '$lib/config';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head
	><title>{data.title} | {appConfig.displayName}</title><meta
		name="description"
		content={data.description}
	/><link rel="canonical" href={`${appConfig.url}/tags/${encodeURIComponent(data.slug)}`} /><meta
		property="og:title"
		content={`${data.title} | ${appConfig.displayName}`}
	/><meta property="og:description" content={data.description} /><meta
		property="og:type"
		content="website"
	/><meta
		property="og:url"
		content={`${appConfig.url}/tags/${encodeURIComponent(data.slug)}`}
	/></svelte:head
>
<PublicShell title={data.title} eyebrow="Tag"
	><header class="listing-hero">
		<div>
			<span>内容标签</span>
			<h1>{data.title}</h1>
			<p>{data.description}</p>
		</div>
		<strong>{data.items.length}<small>条内容</small></strong>
	</header>
	<ContentResults items={data.items} emptyMessage="此标签下暂时没有内容。" /></PublicShell
>
