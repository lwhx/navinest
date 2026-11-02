<script lang="ts">
	import type { NavigationReview } from '$lib/custom-navigation-workspace';

	let {
		review,
		locked,
		confirmed = $bindable(false),
		reviewPage = $bindable(1),
		oncommit,
		oncancel
	}: {
		review: NavigationReview;
		locked: boolean;
		confirmed: boolean;
		reviewPage: number;
		oncommit: () => void;
		oncancel: () => void;
	} = $props();
</script>

<section class="panel operation-review" aria-labelledby="navigation-review-title">
	<h3 id="navigation-review-title">核对操作：{review.plan.title}</h3>
	<p>本次将处理 <strong>{review.plan.affected}</strong> 条记录。{review.plan.detail}</p>
	<ol start={(reviewPage - 1) * 10 + 1}>
		{#each review.plan.items.slice((reviewPage - 1) * 10, reviewPage * 10) as item (item.id)}<li>
				<strong>{item.title}</strong>{#if item.id}
					<span>#{item.id}</span>{/if}{#if item.url}<small>{item.url}</small>{/if}
			</li>{/each}
	</ol>
	<div class="pager">
		<button disabled={locked || reviewPage === 1} onclick={() => reviewPage--}>核对上一页</button
		><span>{reviewPage} / {Math.max(1, Math.ceil(review.plan.items.length / 10))}</span><button
			disabled={locked || reviewPage >= Math.ceil(review.plan.items.length / 10)}
			onclick={() => reviewPage++}>核对下一页</button
		>
	</div>
	<label class="check"
		><input
			type="checkbox"
			bind:checked={confirmed}
			disabled={locked}
		/>我已核对所列记录和影响范围</label
	>
	<div class="actions">
		<button class="primary" disabled={locked || !confirmed} onclick={oncommit}
			>确认执行{review.plan.title}</button
		><button disabled={locked} onclick={oncancel}>返回整理</button>
	</div>
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
	.pager {
		color: var(--nw-muted);
		font-size: 13px;
	}
	.operation-review ol {
		padding-left: 24px;
	}
	.operation-review li {
		padding: 8px 0;
		border-bottom: 1px solid var(--nw-border);
		font-size: 13px;
	}
	.operation-review li small {
		display: block;
		color: var(--nw-muted);
		overflow-wrap: anywhere;
	}
	.operation-review li span {
		color: var(--nw-muted);
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: 16px;
		font-size: 12px;
	}
	.pager > span {
		padding: 10px 2px;
	}
	.check {
		display: flex;
		align-items: center;
		min-height: 44px;
		gap: 10px;
		margin: 10px 0;
	}
	input[type='checkbox'] {
		width: 20px;
		height: 20px;
		accent-color: #c42b3b;
		flex: none;
	}
	label {
		font-size: 13px;
		min-width: 0;
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
	button.primary {
		background: #c42b3b;
		border-color: #c42b3b;
		color: white;
	}
	button:disabled {
		opacity: 0.48;
		cursor: not-allowed;
	}
</style>
