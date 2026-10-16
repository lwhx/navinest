<script lang="ts">
	import { resolve } from '$app/paths';
	let {
		id,
		alt = '',
		large = false
	}: { id: string | number; alt?: string; large?: boolean } = $props();
	let failed = $state(false);
	$effect(() => {
		void id;
		failed = false;
	});
</script>

<div class="media-image" class:large>
	{#if failed}<span role="status">预览不可用<br /><small>图片编号 #{id} 保留</small></span
		>{:else}<img
			src={resolve('/api/admin/files/[id]', { id: String(id) })}
			{alt}
			loading={large ? 'eager' : 'lazy'}
			onerror={() => (failed = true)}
		/>{/if}
</div>

<style>
	.media-image {
		display: grid;
		place-items: center;
		min-width: 0;
		width: 100%;
		height: 140px;
		background: var(--admin-soft);
		border-radius: 10px;
		overflow: hidden;
	}
	.media-image img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.media-image span {
		padding: 12px;
		text-align: center;
		color: var(--admin-muted);
		font-size: 13px;
		line-height: 1.7;
	}
	.large {
		height: min(65vh, 650px);
	}
</style>
