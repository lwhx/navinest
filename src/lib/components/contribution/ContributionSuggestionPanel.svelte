<script lang="ts">
	import type {
		ContributionSnapshot,
		ContributionSuggestion,
		ContributionType
	} from '$lib/contribution-types';

	let {
		type,
		snapshot,
		suggestion,
		aiAvailable,
		busy,
		categoryLabel,
		onapplyall
	}: {
		type: ContributionType;
		snapshot: ContributionSnapshot | null;
		suggestion: ContributionSuggestion | null;
		aiAvailable: boolean;
		busy: boolean;
		categoryLabel: (id: number | null | undefined) => string | undefined;
		onapplyall: () => void;
	} = $props();
</script>

<aside class="account-card suggestion-panel" aria-label="智能建议">
	<div class="account-card-header">
		<div>
			<h2>智能建议</h2>
			<p>
				{aiAvailable ? '根据参考网页整理，采用前请核对。' : '网页读取是辅助步骤，可随时手动填写。'}
			</p>
		</div>
	</div>
	{#if snapshot}<button class="apply-all" type="button" disabled={busy} onclick={onapplyall}
			>采用全部可用建议</button
		>
		<p class="field-hint">仅补全空白项；单项“采用建议”会替换对应字段。</p>
		<dl class="suggestion-list">
			<div>
				<dt>原网页</dt>
				<dd>{snapshot.siteName || snapshot.fetchedUrl}</dd>
			</div>
			<div>
				<dt>原始标题</dt>
				<dd>{snapshot.title || '未提取到'}</dd>
			</div>
			<div>
				<dt>建议标题</dt>
				<dd>{suggestion?.title || snapshot.title || '未生成'}</dd>
			</div>
			<div>
				<dt>建议简介</dt>
				<dd>{suggestion?.summary || snapshot.description || '未提取到'}</dd>
			</div>
			{#if categoryLabel(suggestion?.categoryId)}<div>
					<dt>推荐分类</dt>
					<dd>{categoryLabel(suggestion?.categoryId)}</dd>
				</div>{/if}
		</dl>{:else}<div class="suggestion-empty">
			<strong>{type === 'post' ? '从正文开始' : '按需获取网页信息'}</strong>
			<p>
				{type === 'post'
					? '可直接撰写文章；需要整理参考网页时，再填写参考网址。'
					: '输入网址后可智能获取信息，也可以手动完成收录信息。'}
			</p>
		</div>{/if}
	<div class="ai-boundary">
		<strong>提交前由你确认</strong>
		<p>AI生成内容可能不准确。自动读取只补全空白项，确认后再提交审核。</p>
	</div>
</aside>

<style>
	.account-card-header p {
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.7;
	}
	.field-hint,
	.suggestion-empty p,
	.ai-boundary p {
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.7;
	}
	.apply-all {
		border: 1px solid var(--ui-line);
		border-radius: 8px;
		padding: 10px 12px;
		color: var(--ui-text);
		background: var(--ui-soft);
		font: inherit;
		font-size: 13px;
		min-height: 44px;
		cursor: pointer;
	}
	.suggestion-panel {
		min-width: 0;
	}
	.suggestion-list {
		margin: 0;
	}
	.suggestion-list > div {
		padding: 14px 0;
		border-bottom: 1px solid var(--ui-line);
	}
	.suggestion-list dt {
		margin-bottom: 7px;
		color: var(--ui-muted);
		font-size: 13px;
	}
	.suggestion-list dd {
		margin: 0;
		color: var(--ui-text);
		font-size: 15px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.suggestion-empty {
		padding: 18px 0;
		color: var(--ui-text);
	}
	.ai-boundary {
		margin-top: 20px;
		padding: 12px;
		border-radius: 10px;
		background: var(--ui-soft);
		color: var(--ui-text);
		font-size: 13px;
	}
	.ai-boundary p {
		margin-bottom: 0;
	}
</style>
