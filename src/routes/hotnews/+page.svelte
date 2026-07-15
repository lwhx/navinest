<script lang="ts">
	import { resolve } from '$app/paths';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import { appConfig } from '$lib/config';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let activeSlug = $state('');
	let active = $derived(
		data.sources.find((source) => source.slug === activeSlug) ?? data.sources[0]
	);
	let total = $derived(data.sources.reduce((sum, source) => sum + source.items.length, 0));
	function age(value: string | null) {
		if (!value) return '等待首次更新';
		return new Intl.DateTimeFormat('zh-CN', {
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z')));
	}
</script>

<svelte:head
	><title>今日热榜 | {appConfig.displayName}</title><meta
		name="description"
		content="聚合RSSHub、RSS、Atom与自定义JSON热点榜单"
	/><link rel="canonical" href={`${appConfig.url}/hotnews`} /><meta
		property="og:title"
		content={`今日热榜 | ${appConfig.displayName}`}
	/><meta property="og:description" content="聚合RSSHub、RSS、Atom与自定义JSON热点榜单" /><meta
		property="og:type"
		content="website"
	/><meta property="og:url" content={`${appConfig.url}/hotnews`} /></svelte:head
>
<PublicShell title="今日热榜" eyebrow="Hot Boards">
	<header class="listing-hero hotnews-hero modern-hot-hero">
		<div>
			<span>RSSHUB · RSS · REALTIME</span>
			<h1>发现正在发生的热点</h1>
			<p>一个订阅就是一个独立榜单。聚合多个新闻与社区来源，外链统一经过安全检查。</p>
		</div>
		<div class="hot-hero-stats">
			<strong>{data.sources.length}<small>热点榜单</small></strong><strong
				>{total}<small>聚合条目</small></strong
			>
		</div>
	</header>
	{#if data.sources.length && active}<div class="hot-board-shell">
			<nav class="hot-board-tabs" aria-label="热点榜单">
				{#each data.sources as source (source.id)}<button
						type="button"
						class:active={source.slug === active.slug}
						aria-pressed={source.slug === active.slug}
						onclick={() => (activeSlug = source.slug)}
						style={`--tab-accent:${source.accentColor};--tab-surface:${source.surfaceColor}`}
					>
						<span>{source.icon}</span><span
							><strong>{source.name}</strong><small
								>{source.items.length} 条 · {source.type === 'rss' ? 'RSS' : 'JSON'}</small
							></span
						>
					</button>{/each}
			</nav>
			<section
				class={`hot-board-panel layout-${active.layout}`}
				style={`--board-accent:${active.accentColor};--board-surface:${active.surfaceColor}`}
				aria-live="polite"
			>
				<header class="hot-board-head">
					<div class="hot-board-brand">
						<span>{active.icon}</span>
						<div>
							<p>HOT BOARD</p>
							<h2>{active.name}</h2>
							{#if active.description}<small>{active.description}</small>{/if}
						</div>
					</div>
					<div class="hot-board-meta">
						<span>{active.type === 'rss' ? 'RSSHUB / RSS' : 'JSON API'}</span><time
							>更新于 {age(active.lastSuccessAt ?? active.lastFetchAt)}</time
						>
					</div>
				</header>
				{#if active.items.length}<ol class="hot-board-rank">
						{#each active.items as item (item.rank)}<li>
								<span class="hot-rank-number">{item.rank}</span>
								<div class="hot-rank-copy">
									<a
										href={resolve(`/go?url=${encodeURIComponent(item.url)}` as '/go')}
										target="_blank"
										rel="external noopener noreferrer">{item.title}</a
									>{#if active.showDescription && item.extra?.description}<p>
											{String(item.extra.description)}
										</p>{/if}
								</div>
								{#if item.hotValue}<strong class="hot-value">{item.hotValue}</strong>{/if}
							</li>{/each}
					</ol>{:else}<div class="empty-state">
						<strong>正在等待首次刷新</strong>
						<p>管理员刷新该订阅或定时任务执行后，榜单会显示在这里。</p>
					</div>{/if}
			</section>
		</div>{:else}<div class="empty-state">
			<strong>暂时没有热点榜单</strong>
			<p>管理员添加一个RSSHub、RSS、Atom或JSON订阅后，这里会生成一个独立榜单。</p>
			<a class="primary-action" href={resolve('/')}>返回首页</a>
		</div>{/if}
</PublicShell>

<style>
	.modern-hot-hero {
		background: linear-gradient(135deg, #17151d 0%, #2d2137 58%, #501d36 100%);
	}
	.modern-hot-hero > div:first-child span {
		color: #ff8d9b;
	}
	.hot-hero-stats {
		display: flex;
		gap: 10px;
	}
	.hot-hero-stats strong {
		display: grid;
		min-width: 92px;
		min-height: 82px;
		place-items: center;
		align-content: center;
		border: 1px solid #ffffff24;
		border-radius: 14px;
		background: #ffffff12;
		font-size: 24px;
	}
	.hot-hero-stats small {
		margin-top: 4px;
		color: #ffffffa8;
		font-size: 9px;
		font-weight: 600;
	}
	.hot-board-shell {
		display: grid;
		grid-template-columns: 240px minmax(0, 1fr);
		gap: 16px;
		align-items: start;
	}
	.hot-board-tabs {
		display: grid;
		gap: 7px;
		position: sticky;
		top: 86px;
	}
	.hot-board-tabs button {
		display: grid;
		grid-template-columns: 38px minmax(0, 1fr);
		gap: 10px;
		align-items: center;
		width: 100%;
		border: 1px solid #e4e5e8;
		border-radius: 12px;
		padding: 10px;
		background: #fff;
		text-align: left;
		cursor: pointer;
	}
	.hot-board-tabs button > span:first-child {
		display: grid;
		width: 36px;
		height: 36px;
		place-items: center;
		border-radius: 10px;
		color: var(--tab-accent);
		background: var(--tab-surface);
		font-weight: 850;
	}
	.hot-board-tabs button > span:last-child {
		display: grid;
		min-width: 0;
		gap: 3px;
	}
	.hot-board-tabs strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
	}
	.hot-board-tabs small {
		color: #92959a;
		font-size: 9px;
	}
	.hot-board-tabs button:hover,
	.hot-board-tabs button.active {
		border-color: var(--tab-accent);
		box-shadow:
			inset 3px 0 var(--tab-accent),
			0 5px 16px #20242b0a;
	}
	.hot-board-panel {
		overflow: hidden;
		border: 1px solid #e3e4e7;
		border-radius: 16px;
		background: #fff;
		box-shadow: 0 12px 36px #20242b0b;
	}
	.hot-board-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		border-bottom: 1px solid #ececef;
		padding: 18px 20px;
		background: linear-gradient(135deg, var(--board-surface), #fff);
	}
	.hot-board-brand {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.hot-board-brand > span {
		display: grid;
		width: 48px;
		height: 48px;
		place-items: center;
		border-radius: 13px;
		color: #fff;
		background: var(--board-accent);
		font-size: 20px;
		font-weight: 900;
	}
	.hot-board-brand p,
	.hot-board-brand h2,
	.hot-board-brand small {
		margin: 0;
	}
	.hot-board-brand p {
		color: var(--board-accent);
		font-size: 9px;
		font-weight: 850;
		letter-spacing: 0.12em;
	}
	.hot-board-brand h2 {
		margin: 2px 0;
		font-size: 20px;
	}
	.hot-board-brand small {
		color: #777c84;
		font-size: 10px;
	}
	.hot-board-meta {
		display: grid;
		gap: 5px;
		color: #8b8f96;
		font-size: 9px;
		text-align: right;
	}
	.hot-board-meta span {
		color: var(--board-accent);
		font-weight: 750;
	}
	.hot-board-rank {
		display: grid;
		margin: 0;
		padding: 0 20px;
		list-style: none;
	}
	.hot-board-rank li {
		display: grid;
		grid-template-columns: 38px minmax(0, 1fr) auto;
		gap: 12px;
		align-items: center;
		min-height: 58px;
		border-bottom: 1px solid #f0f1f3;
		padding: 8px 0;
	}
	.hot-board-rank li:last-child {
		border-bottom: 0;
	}
	.hot-rank-number {
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		border-radius: 8px;
		color: #8b8f96;
		background: #f1f2f4;
		font-size: 11px;
		font-weight: 850;
	}
	.hot-board-rank li:nth-child(-n + 3) .hot-rank-number {
		color: #fff;
		background: var(--board-accent);
	}
	.hot-rank-copy {
		min-width: 0;
	}
	.hot-rank-copy a {
		display: block;
		overflow: hidden;
		color: #34373c;
		font-size: 13px;
		font-weight: 680;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hot-rank-copy p {
		margin: 4px 0 0;
		overflow: hidden;
		color: #8b8f96;
		font-size: 10px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hot-value {
		color: var(--board-accent);
		font-size: 10px;
	}
	.layout-compact .hot-board-rank li {
		min-height: 44px;
	}
	.layout-columns .hot-board-rank {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0 22px;
	}
	@media (max-width: 800px) {
		.hot-board-shell {
			grid-template-columns: 1fr;
		}
		.hot-board-tabs {
			position: static;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.layout-columns .hot-board-rank {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 520px) {
		.hot-board-tabs {
			display: flex;
			overflow-x: auto;
		}
		.hot-board-tabs button {
			min-width: 180px;
		}
		.hot-board-head {
			align-items: flex-start;
		}
		.hot-board-meta {
			display: none;
		}
		.hot-board-rank {
			padding: 0 12px;
		}
		.hot-hero-stats {
			display: none;
		}
	}
</style>
