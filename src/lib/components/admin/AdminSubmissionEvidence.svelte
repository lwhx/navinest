<script lang="ts">
	type EvidenceSubmission = {
		title: string;
		payload: {
			summary?: string | null;
			content?: string | null;
			userCategoryId?: number | null;
			iconFileId?: number | null;
			webSnapshot?: {
				title?: string | null;
				description?: string | null;
				siteName?: string | null;
			} | null;
			aiSuggestion?: {
				provider?: string | null;
				model?: string | null;
				title?: string | null;
				summary?: string | null;
				categoryName?: string | null;
				categoryReason?: string | null;
				tags?: string[] | null;
			} | null;
		};
	};

	let {
		submission,
		categories
	}: {
		submission: EvidenceSubmission;
		categories: { id: number; name: string }[];
	} = $props();
</script>

<div class="review-evidence">
	<section>
		<h3>用户最终提交</h3>
		<dl>
			<dt>标题</dt>
			<dd>{submission.title}</dd>
			<dt>简介</dt>
			<dd>{submission.payload.summary || '未填写'}</dd>
			<dt>补充说明</dt>
			<dd>{submission.payload.content || '未填写'}</dd>
			<dt>分类</dt>
			<dd>
				{categories.find((category) => category.id === submission.payload.userCategoryId)?.name ||
					'未选择'}
			</dd>
			<dt>图标</dt>
			<dd>
				{#if submission.payload.iconFileId}<img
						class="review-icon"
						src={`/api/admin/files/${submission.payload.iconFileId}`}
						alt="投稿图标"
					/>{:else}未选择{/if}
			</dd>
		</dl>
	</section>
	<section>
		<h3>网页原始提取</h3>
		{#if submission.payload.webSnapshot}<dl>
				<dt>原始标题</dt>
				<dd>{submission.payload.webSnapshot.title || '无'}</dd>
				<dt>网页描述</dt>
				<dd>{submission.payload.webSnapshot.description || '无'}</dd>
				<dt>站点</dt>
				<dd>{submission.payload.webSnapshot.siteName || '无'}</dd>
			</dl>{:else}<p>此投稿没有网页快照。</p>{/if}
	</section>
	<section class="ai-evidence">
		<h3>✦ AI建议</h3>
		{#if submission.payload.aiSuggestion}<dl>
				<dt>模型</dt>
				<dd>
					{submission.payload.aiSuggestion.provider} / {submission.payload.aiSuggestion.model}
				</dd>
				<dt>标题</dt>
				<dd>{submission.payload.aiSuggestion.title}</dd>
				<dt>简介</dt>
				<dd>{submission.payload.aiSuggestion.summary}</dd>
				<dt>推荐分类</dt>
				<dd>
					{submission.payload.aiSuggestion.categoryName ||
						'未判断'}{#if submission.payload.aiSuggestion.categoryReason}<br />{submission.payload
							.aiSuggestion.categoryReason}{/if}
				</dd>
				<dt>标签</dt>
				<dd class="suggested-tags">
					{#each submission.payload.aiSuggestion.tags as tag (tag)}<span>{tag}</span>{/each}
				</dd>
			</dl>{:else}<p>未使用AI生成。</p>{/if}
	</section>
</div>

<style>
	.review-evidence {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		padding: 16px 18px;
	}
	.review-evidence section {
		border: 1px solid var(--admin-border);
		border-radius: 10px;
		padding: 13px;
		background: var(--admin-soft);
	}
	.review-evidence section.ai-evidence {
		border-color: var(--admin-border);
		background: var(--admin-soft);
	}
	.review-evidence h3 {
		margin: 0 0 10px;
		font-size: 14px;
	}
	.review-evidence dl {
		display: grid;
		gap: 4px;
		margin: 0;
	}
	.review-evidence dt {
		margin-top: 7px;
		color: var(--admin-muted);
		font-size: 13px;
		font-weight: 700;
	}
	.review-evidence dd {
		overflow-wrap: anywhere;
		margin: 0;
		color: var(--admin-text);
		font-size: 13px;
		line-height: 1.55;
	}
	.suggested-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.suggested-tags span {
		border-radius: 999px;
		padding: 3px 6px;
		background: var(--admin-soft);
	}
	.review-icon {
		width: 44px;
		height: 44px;
		border-radius: 9px;
		background: var(--admin-surface);
		object-fit: contain;
	}
	@media (max-width: 1000px) {
		.review-evidence {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 600px) {
		.review-evidence {
			padding: 12px;
		}
	}
</style>
