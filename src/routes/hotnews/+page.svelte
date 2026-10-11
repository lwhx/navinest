<script lang="ts">
	import { resolve } from '$app/paths';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import { appConfig } from '$lib/config';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
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
	function boardStatus(source: (typeof data.sources)[number]) {
		if (source.hasError) return { kind: 'error', label: '更新异常', detail: '显示上次成功数据' };
		const updatedAt = source.lastSuccessAt ?? source.lastFetchAt;
		if (!updatedAt) return { kind: 'waiting', label: '等待更新', detail: '尚无成功数据' };
		const timestamp = new Date(updatedAt.replace(' ', 'T') + (updatedAt.includes('Z') ? '' : 'Z'));
		if (Date.now() - timestamp.getTime() > 36 * 60 * 60 * 1000)
			return { kind: 'stale', label: '数据较旧', detail: '等待下一次更新' };
		return { kind: 'healthy', label: '更新正常', detail: '数据已缓存' };
	}
	function accentColors(hex: string) {
		const channels = [1, 3, 5].map(
				(index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255
			),
			linear = channels.map((channel) =>
				channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
			),
			luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
		return {
			text: luminance > 0.32 ? '#34373c' : hex,
			onAccent: luminance > 0.46 ? '#17191c' : '#ffffff'
		};
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
			<p>多个榜单同时呈现，一屏浏览新闻、社区和趋势热点。</p>
		</div>
		<div class="hot-hero-stats">
			<strong>{data.sources.length}<small>热点榜单</small></strong><strong
				>{total}<small>聚合条目</small></strong
			>
		</div>
	</header>
	{#if data.sources.length}<div class="hot-board-card-grid">
			{#each data.sources as source (source.id)}<article
					class={`hot-board-card layout-${source.layout}`}
					class:has-error={boardStatus(source).kind === 'error'}
					style={`--board-accent:${source.accentColor};--board-accent-text:${accentColors(source.accentColor).text};--board-on-accent:${accentColors(source.accentColor).onAccent};--board-surface:${source.surfaceColor}`}
				>
					<header class="hot-board-head">
						<div class="hot-board-brand">
							<span>{source.icon}</span>
							<div>
								<p>
									{source.type === 'rss'
										? 'RSSHUB / RSS'
										: source.type === 'html'
											? '网页抓取'
											: 'JSON API'}
								</p>
								<h2>{source.name}</h2>
								{#if source.description}<small>{source.description}</small>{/if}
							</div>
						</div>
						<div class="hot-board-meta">
							<span class={`board-status ${boardStatus(source).kind}`}
								>{boardStatus(source).label}</span
							><time>{age(source.lastSuccessAt ?? source.lastFetchAt)}</time>
						</div>
					</header>
					{#if source.items.length}<ol class="hot-board-rank">
							{#each source.items as item (item.rank)}<li>
									<span class="hot-rank-number">{item.rank}</span>
									<div class="hot-rank-copy">
										<a
											href={resolve(`/go?url=${encodeURIComponent(item.url)}` as '/go')}
											title={item.title}
											target="_blank"
											rel="external noopener noreferrer">{item.title}</a
										>{#if source.showDescription && item.extra?.description}<p>
												{String(item.extra.description)}
											</p>{/if}
									</div>
									{#if item.hotValue}<strong class="hot-value">{item.hotValue}</strong>{/if}
								</li>{/each}
						</ol>{:else}<div class="board-empty">
							<strong>等待首次刷新</strong>
							<p>刷新订阅后将在这里显示热点。</p>
						</div>{/if}
					<footer>
						<span>{boardStatus(source).detail}</span><span
							>{source.items.length > 10
								? `滚动查看全部 ${source.items.length} 条`
								: `共 ${source.items.length} 条`}</span
						>
					</footer>
				</article>{/each}
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
	.hot-board-card-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
		align-items: start;
	}
	.hot-board-card {
		overflow: hidden;
		min-width: 0;
		border: 1px solid #e3e4e7;
		border-radius: 14px;
		background: #fff;
		box-shadow: 0 8px 26px #20242b0a;
	}
	.hot-board-card.has-error {
		border-color: #e9b9bd;
	}
	.hot-board-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-height: 76px;
		border-bottom: 1px solid #ececef;
		padding: 12px 14px;
		background: linear-gradient(135deg, var(--board-surface), #fff 72%);
	}
	.hot-board-brand {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 10px;
	}
	.hot-board-brand > span {
		display: grid;
		width: 40px;
		height: 40px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 11px;
		color: var(--board-on-accent);
		background: var(--board-accent);
		font-size: 18px;
		font-weight: 900;
	}
	.hot-board-brand > div {
		min-width: 0;
	}
	.hot-board-brand p,
	.hot-board-brand h2,
	.hot-board-brand small {
		margin: 0;
	}
	.hot-board-brand p {
		color: var(--board-accent-text);
		font-size: 10px;
		font-weight: 850;
		letter-spacing: 0.08em;
	}
	.hot-board-brand h2 {
		margin: 2px 0;
		overflow: hidden;
		font-size: 18px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hot-board-brand small {
		display: block;
		overflow: hidden;
		color: #777c84;
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hot-board-meta {
		display: grid;
		flex: 0 0 auto;
		gap: 4px;
		color: #8b8f96;
		font-size: 11px;
		text-align: right;
	}
	.hot-board-meta span {
		color: var(--board-accent-text);
		font-weight: 800;
	}
	.board-status {
		border-radius: 999px;
		padding: 2px 6px;
		background: #ffffffc7;
	}
	.board-status.error {
		color: #b42d39;
		background: #fff0f1;
	}
	.board-status.stale,
	.board-status.waiting {
		color: #85651e;
		background: #fff8df;
	}
	.hot-board-rank {
		display: grid;
		max-height: 440px;
		margin: 0;
		overflow-y: auto;
		padding: 4px 12px;
		list-style: none;
		scrollbar-color: var(--board-accent) transparent;
		scrollbar-width: thin;
	}

	.hot-board-rank li {
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr) auto;
		gap: 8px;
		align-items: center;
		min-height: 44px;
		border-bottom: 1px solid #f0f1f3;
		padding: 5px 0;
	}
	.hot-board-rank li:last-child {
		border-bottom: 0;
	}
	.hot-rank-number {
		display: grid;
		width: 23px;
		height: 23px;
		place-items: center;
		border-radius: 7px;
		color: #8b8f96;
		background: #f1f2f4;
		font-size: 11px;
		font-weight: 850;
	}
	.hot-board-rank li:nth-child(-n + 3) .hot-rank-number {
		color: var(--board-on-accent);
		background: var(--board-accent);
	}
	.hot-rank-copy {
		min-width: 0;
	}
	.hot-rank-copy a {
		display: block;
		overflow: hidden;
		color: #34373c;
		font-size: 14px;
		font-weight: 680;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hot-rank-copy a:focus-visible {
		border-radius: 3px;
		outline: 2px solid var(--board-accent-text);
		outline-offset: 2px;
	}
	.hot-rank-copy p {
		margin: 3px 0 0;
		overflow: hidden;
		color: #8b8f96;
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hot-value {
		max-width: 78px;
		overflow: hidden;
		color: var(--board-accent-text);
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hot-board-card > footer {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		border-top: 1px solid #f0f1f3;
		padding: 8px 12px;
		color: #969aa1;
		background: #fbfbfc;
		font-size: 10px;
	}
	.board-empty {
		display: grid;
		min-height: 180px;
		place-content: center;
		text-align: center;
	}
	.board-empty p {
		margin: 5px 0;
		color: #92969d;
		font-size: 10px;
	}
	.layout-compact .hot-board-rank li {
		min-height: 36px;
		padding: 3px 0;
	}
	.layout-compact .hot-board-head {
		min-height: 66px;
	}
	.layout-columns {
		grid-column: span 2;
	}
	.layout-columns .hot-board-rank {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0 18px;
	}
	@media (max-width: 1350px) {
		.hot-board-card-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 760px) {
		.hot-board-card-grid {
			grid-template-columns: 1fr;
		}
		.layout-columns {
			grid-column: auto;
		}
		.layout-columns .hot-board-rank {
			grid-template-columns: 1fr;
		}
		.hot-board-rank {
			max-height: none;
			overflow-y: visible;
		}
	}
	@media (max-width: 520px) {
		.hot-hero-stats {
			display: none;
		}
		.hot-board-head {
			align-items: flex-start;
		}
		.hot-board-meta time {
			display: none;
		}
	}
	:root[data-theme='dark'] .hot-board-card {
		border-color: rgba(255, 255, 255, 0.08);
		background: #1c2220;
		box-shadow: 0 8px 26px rgba(0, 0, 0, 0.35);
	}
	:root[data-theme='dark'] .hot-board-card.has-error {
		border-color: #7a282f;
	}
	:root[data-theme='dark'] .hot-board-head {
		border-bottom-color: rgba(255, 255, 255, 0.08);
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.03), #1c2220 72%);
	}
	:root[data-theme='dark'] .hot-board-brand h2 {
		color: #edf1ef;
	}
	:root[data-theme='dark'] .hot-board-brand small {
		color: #929995;
	}
	:root[data-theme='dark'] .hot-board-meta {
		color: #828a86;
	}
	:root[data-theme='dark'] .board-status {
		background: rgba(255, 255, 255, 0.08);
	}
	:root[data-theme='dark'] .board-status.error {
		color: #f87171;
		background: rgba(239, 68, 68, 0.15);
	}
	:root[data-theme='dark'] .board-status.stale,
	:root[data-theme='dark'] .board-status.waiting {
		color: #fbbf24;
		background: rgba(245, 158, 11, 0.15);
	}
	:root[data-theme='dark'] .hot-board-rank li {
		border-bottom-color: rgba(255, 255, 255, 0.06);
	}
	:root[data-theme='dark'] .hot-rank-number {
		color: #828a86;
		background: rgba(255, 255, 255, 0.06);
	}
	:root[data-theme='dark'] .hot-rank-copy a {
		color: #dde3e0;
	}
	:root[data-theme='dark'] .hot-rank-copy a:hover {
		color: #fff;
	}
	:root[data-theme='dark'] .hot-rank-copy p {
		color: #828a86;
	}
	:root[data-theme='dark'] .hot-board-card > footer {
		border-top-color: rgba(255, 255, 255, 0.06);
		color: #747d79;
		background: #161b19;
	}
	:root[data-theme='dark'] .board-empty p {
		color: #747d79;
	}
</style>
