<script lang="ts">
	import { navigating } from '$app/state';

	import './layout.css';
	import './quality-hardening.css';
	import favicon from '$lib/assets/favicon.svg';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { appConfig } from '$lib/config';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{appConfig.displayName}</title>
	<meta property="og:site_name" content={appConfig.displayName} />
	<meta name="twitter:card" content="summary" />
</svelte:head>

<a class="skip-link" href="#main-content">跳到主要内容</a>

{#if navigating.to}
	<div class="navigation-progress" role="progressbar" aria-label="页面加载中"></div>
{/if}

<div id="main-content" tabindex="-1">{@render children()}</div>
<ThemeToggle />
