<script lang="ts">
	import { resolve } from '$app/paths';
	import { appConfig } from '$lib/config';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>安全跳转 | {appConfig.displayName}</title>
</svelte:head>

<main class="gateway-page">
	<section class="gateway-panel invalid">
		<p class="eyebrow">External Link</p>
		<h1>无法打开此地址</h1>
		<p class="gateway-reason">{data.reason}</p>
		<a class="secondary-action" href={resolve('/')}>返回首页</a>
	</section>
</main>
