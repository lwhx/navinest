<script lang="ts">
	import type { NavigationCategory, NavigationMutation } from '$lib/custom-navigation-workspace';

	let {
		ids,
		inFilter,
		disabled,
		categories,
		bulkCategory = $bindable(''),
		onprepare
	}: {
		ids: number[];
		inFilter: number;
		disabled: boolean;
		categories: NavigationCategory[];
		bulkCategory: string;
		onprepare: (mutation: NavigationMutation) => void;
	} = $props();
</script>

<section class="panel bulk" aria-label="批量整理">
	<h3>已勾选 {ids.length} 条</h3>
	<p class="muted">
		当前筛选内 {inFilter} 条，其他筛选内 {ids.length - inFilter} 条。跨页勾选会保留，每批最多 500 条。
	</p>
	<fieldset {disabled}>
		<label
			><span>批量目标分类</span><select bind:value={bulkCategory}
				><option value="">未分类</option>{#each categories as category (category.id)}<option
						value={String(category.id)}>{category.name} #{category.id}</option
					>{/each}</select
			></label
		>
		<div class="actions">
			<button
				onclick={() =>
					onprepare({
						kind: 'link-bulk',
						ids: [...ids],
						change: 'move',
						categoryId: bulkCategory ? Number(bulkCategory) : null
					})}>移动到分类</button
			><button onclick={() => onprepare({ kind: 'link-bulk', ids: [...ids], change: 'active' })}
				>批量启用</button
			><button onclick={() => onprepare({ kind: 'link-bulk', ids: [...ids], change: 'inactive' })}
				>批量停用</button
			><button class="danger" onclick={() => onprepare({ kind: 'link-delete', ids: [...ids] })}
				>删除所选</button
			>
		</div>
	</fieldset>
</section>

<style>
	.panel {
		padding: 18px;
		background: var(--nw-soft);
		border: 1px solid var(--nw-border);
		border-radius: 12px;
		margin: 14px 0;
		overflow-wrap: anywhere;
	}
	h3 {
		color: var(--nw-text);
		margin: 0 0 6px;
	}
	p {
		margin: 0 0 10px;
		line-height: 1.6;
	}
	.muted {
		color: var(--nw-muted);
		font-size: 13px;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	label {
		display: grid;
		gap: 7px;
		font-size: 13px;
		min-width: 0;
	}
	select {
		box-sizing: border-box;
		min-width: 0;
		width: 100%;
		min-height: 44px;
		border: 1px solid var(--nw-border);
		background: var(--nw-bg);
		border-radius: 8px;
		color: var(--nw-text);
		padding: 10px;
		font: inherit;
	}
	.bulk fieldset {
		display: flex;
		align-items: end;
		flex-wrap: wrap;
		gap: 12px;
	}
	.bulk label {
		flex: 1 1 180px;
	}
	.bulk .actions {
		flex: 2 1 330px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	button {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border: 1px solid var(--nw-border);
		border-radius: 9px;
		background: var(--nw-bg);
		color: var(--nw-text);
		padding: 10px 13px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		text-align: center;
		line-height: 1.4;
	}
	button:hover:not(:disabled) {
		border-color: #c22c3c;
		background: var(--nw-soft);
	}
	button.danger {
		color: #b62333;
		border-color: #dba8af;
	}
	:global([data-theme='dark']) button.danger {
		color: #ffabb5;
	}
	button:disabled {
		opacity: 0.48;
		cursor: not-allowed;
	}
</style>
