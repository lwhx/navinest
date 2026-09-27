<script lang="ts">
	import { navigating } from '$app/state';
	import { resolve } from '$app/paths';

	import './layout.css';
	import './quality-hardening.css';
	import favicon from '$lib/assets/favicon.svg';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { provideSiteSettings } from '$lib/site-context';
	import { siteDisplayName } from '$lib/types/site';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const site = $derived(data.site);
	const displayName = $derived(siteDisplayName(site));
	const announcementKey = $derived(`navinest-announcement:${site.announcementMessage}`);

	provideSiteSettings(() => site);

	let hidden = $derived(isDismissed(announcementKey));

	function isDismissed(key: string) {
		try {
			return localStorage.getItem(key) === '1';
		} catch {
			return false;
		}
	}

	function dismiss() {
		hidden = true;
		try {
			localStorage.setItem(announcementKey, '1');
		} catch {
			/* 隐私模式下忽略存储失败 */
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{displayName}</title>
	<meta property="og:site_name" content={displayName} />
	<meta name="twitter:card" content="summary" />
</svelte:head>

<a class="skip-link" href="#main-content">跳到主要内容</a>

{#if navigating.to}
	<div class="navigation-progress" role="progressbar" aria-label="页面加载中"></div>
{/if}

{#if site.announcementEnabled && site.announcementMessage && !hidden}
	<aside class="site-announcement" aria-label="站点公告">
		<p>{site.announcementMessage}</p>
		{#if site.announcementLink}<a
				href={site.announcementLink.startsWith('/')
					? resolve(site.announcementLink as '/')
					: site.announcementLink}
				rel="external">{site.announcementLinkLabel || '查看详情'}</a
			>{/if}
		<button type="button" aria-label="关闭公告" onclick={dismiss}>×</button>
	</aside>
{/if}

<div id="main-content" tabindex="-1">{@render children()}</div>
<ThemeToggle />

<style>
	.site-announcement {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		border-bottom: 1px solid rgba(148, 163, 184, 0.35);
		background: rgba(37, 99, 235, 0.08);
		font-size: 14px;
	}

	.site-announcement p {
		margin: 0;
		flex: 1;
	}

	.site-announcement a {
		font-weight: 600;
		text-decoration: underline;
		white-space: nowrap;
	}

	.site-announcement button {
		border: 0;
		background: transparent;
		color: inherit;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		opacity: 0.7;
	}

	.site-announcement button:hover {
		opacity: 1;
	}
</style>
