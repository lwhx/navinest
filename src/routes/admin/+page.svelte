<script lang="ts">
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	const metrics = $derived([
		{ label: '内容', value: data.items },
		{ label: '分类', value: data.categories },
		{ label: '标签', value: data.tags },
		{ label: '用户', value: data.users },
		{ label: '待审投稿', value: data.submissions }
	]);
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Dashboard</p>
		<h1>后台概览</h1>
	</div>
</header>

{#if data.source === 'fallback'}
	<p class="admin-notice">当前显示本地示例数据，修改功能将在 D1 写入服务接入后启用。</p>
{/if}

<section class="admin-metrics" aria-label="数据概览">
	{#each metrics as metric (metric.label)}
		<article><span>{metric.label}</span><strong>{metric.value}</strong></article>
	{/each}
</section>
