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
	<section class:invalid={!data.valid} class="gateway-panel">
		<p class="eyebrow">External Link</p>
		<h1>{data.valid ? '即将离开 NaviNest' : '无法打开此地址'}</h1>
		{#if data.valid}
			<p>目标站点</p>
			<strong class="gateway-host">{data.host}</strong>
			<p class="gateway-url">{data.target}</p>
			<div class="gateway-actions">
				<a
					class="primary-action"
					href={data.target}
					target="_blank"
					rel="external noopener noreferrer">继续访问</a
				>
				<a class="secondary-action" href={resolve('/')}>返回首页</a>
			</div>
		{:else}
			<p class="gateway-reason">{data.reason}</p>
			<a class="secondary-action" href={resolve('/')}>返回首页</a>
		{/if}
	</section>
</main>
