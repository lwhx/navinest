<script lang="ts">
	import { resolve } from '$app/paths';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	type Snapshot = {
		fetchedUrl: string;
		title: string;
		description: string;
		excerpt: string;
		siteName: string;
		iconUrl?: string;
		fetchedAt: string;
	};
	type Suggestion = {
		title: string;
		summary: string;
		content: string;
		tags: string[];
		categoryId?: number | null;
		categoryName?: string | null;
		categoryReason?: string;
	};
	let type = $state('site'),
		title = $state(''),
		summary = $state(''),
		content = $state(''),
		url = $state(''),
		tagInput = $state(''),
		categoryId = $state<number | null>(null),
		iconFileId = $state<number | null>(null),
		iconSource = $state<'auto' | 'manual' | null>(null),
		iconPreviewUrl = $state(''),
		iconSaving = $state(false),
		duplicate = $state<{ published: string[]; pendingCount: number }>({
			published: [],
			pendingCount: 0
		}),
		message = $state(''),
		submitting = $state(false),
		enriching = $state(false),
		snapshot = $state<Snapshot | null>(null),
		suggestion = $state<Suggestion | null>(null),
		aiMeta = $state<{ available: boolean; provider?: string; model?: string }>({
			available: false
		}),
		enrichStage = $state('');
	let availableCategories = $derived(data.categories.filter((category) => category.type === type));
	const tags = $derived(
		[
			...new Set(
				tagInput
					.split(/[，,\n]/)
					.map((tag) => tag.trim())
					.filter(Boolean)
			)
		].slice(0, 8)
	);
	function apply(field: 'title' | 'summary' | 'content') {
		const value =
			suggestion?.[field] ??
			(field === 'title'
				? snapshot?.title
				: field === 'summary'
					? snapshot?.description
					: snapshot?.excerpt) ??
			'';
		if (field === 'title') title = value;
		else if (field === 'summary') summary = value;
		else content = value;
	}
	function applyAll() {
		apply('title');
		apply('summary');
		apply('content');
		if (suggestion?.tags.length) tagInput = suggestion.tags.join('，');
		if (
			!categoryId &&
			suggestion?.categoryId &&
			availableCategories.some((category) => category.id === suggestion?.categoryId)
		)
			categoryId = suggestion.categoryId;
	}
	async function saveRemoteIcon() {
		if (!snapshot?.iconUrl || iconSaving) return;
		iconSaving = true;
		message = '';
		try {
			const response = await fetch('/api/submissions/icon', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ url: snapshot.iconUrl })
				}),
				body = await response.json();
			if (!response.ok) throw new Error(body.error ?? '图标保存失败。');
			iconFileId = body.data.id;
			iconSource = 'auto';
			iconPreviewUrl = body.data.previewUrl;
		} catch (error) {
			message = error instanceof Error ? error.message : '图标保存失败。';
		} finally {
			iconSaving = false;
		}
	}
	async function uploadIcon(event: Event) {
		const input = event.currentTarget as HTMLInputElement,
			file = input.files?.[0];
		if (!file) return;
		iconSaving = true;
		message = '';
		try {
			const form = new FormData();
			form.set('file', file);
			const response = await fetch('/api/user/files', { method: 'POST', body: form }),
				body = await response.json();
			if (!response.ok) throw new Error(body.error ?? '图标上传失败。');
			iconFileId = body.data.id;
			iconSource = 'manual';
			iconPreviewUrl = `/api/user/files/${body.data.id}`;
		} catch (error) {
			message = error instanceof Error ? error.message : '图标上传失败。';
		} finally {
			iconSaving = false;
			input.value = '';
		}
	}
	async function enrich() {
		if (!url.trim()) {
			message = '请先输入网页地址。';
			return;
		}
		enriching = true;
		message = '';
		enrichStage = '正在安全访问网页并提取信息…';
		try {
			const response = await fetch('/api/submissions/enrich', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url, type })
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? '智能获取失败。');
			snapshot = body.snapshot;
			suggestion = body.suggestion;
			duplicate = body.duplicate ?? { published: [], pendingCount: 0 };
			aiMeta = body.ai;
			enrichStage = body.ai.available
				? `AI已生成建议 · ${body.ai.provider} / ${body.ai.model}`
				: '网页信息已提取；AI尚未配置，已使用原始网页信息。';
			if (!title.trim()) apply('title');
			if (!summary.trim()) apply('summary');
			if (!content.trim()) apply('content');
			if (!tagInput.trim() && body.suggestion?.tags?.length)
				tagInput = body.suggestion.tags.join('，');
			if (!categoryId && body.suggestion?.categoryId) categoryId = body.suggestion.categoryId;
		} catch (error) {
			message = error instanceof Error ? error.message : '智能获取失败，请手动填写。';
			enrichStage = '';
		} finally {
			enriching = false;
		}
	}
	async function submit() {
		submitting = true;
		message = '';
		try {
			const aiSuggestion =
				suggestion && aiMeta.available
					? {
							...suggestion,
							provider: aiMeta.provider ?? '',
							model: aiMeta.model ?? '',
							generatedAt: new Date().toISOString()
						}
					: null;
			const response = await fetch('/api/submissions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					type,
					title,
					summary,
					content,
					url,
					userCategoryId: categoryId,
					iconFileId,
					iconSource,
					tagNames: tags,
					webSnapshot: snapshot,
					aiSuggestion
				})
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? '投稿失败。');
			location.href = resolve('/user/submissions');
		} catch (error) {
			message = error instanceof Error ? error.message : '投稿失败，请稍后重试。';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head><title>AI辅助投稿 | NaviNest 导航巢</title></svelte:head>
<AccountShell
	title="提交网页"
	description={`${data.user.displayName}，输入网址，让系统帮助整理收录信息。`}
	eyebrow="AI CONTRIBUTION"
>
	<div class="contribute-flow">
		<section class="account-card url-stage">
			<div class="account-card-header">
				<div>
					<span class="step">01</span>
					<h2>输入网页地址</h2>
					<p>系统会安全抓取公开网页，再由AI生成可编辑建议。</p>
				</div>
			</div>
			<div class="url-command">
				<input
					bind:value={url}
					type="url"
					required
					placeholder="https://example.com"
					aria-label="网页地址"
				/><button class="account-button" type="button" disabled={enriching} onclick={enrich}
					>{enriching ? '正在分析…' : '智能获取网页信息'}</button
				>
			</div>
			{#if enrichStage}<p class="ai-status" role="status"><span>✦</span>{enrichStage}</p>{/if}
			{#if duplicate.published.length || duplicate.pendingCount}<div
					class="duplicate-warning"
					role="status"
				>
					<strong>发现可能的重复链接</strong>
					{#if duplicate.published.length}<p>已收录：{duplicate.published.join('、')}</p>{/if}
					{#if duplicate.pendingCount}<p>
							另有 {duplicate.pendingCount} 条待审核投稿使用相同链接。
						</p>{/if}
					<small>你仍可继续投稿，管理员会在审核时判断。</small>
				</div>{/if}
			{#if message}<p class="account-note" role="alert">{message}</p>{/if}
		</section>

		<div class="contribute-columns">
			<section class="account-card">
				<div class="account-card-header">
					<div>
						<span class="step">02</span>
						<h2>确认投稿内容</h2>
						<p>AI只提供建议，提交前请确认信息准确。</p>
					</div>
				</div>
				<form
					class="account-form"
					onsubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<label
						><span>内容类型</span><select bind:value={type} onchange={() => (categoryId = null)}
							><option value="site">网址</option><option value="app">应用</option><option
								value="post">文章</option
							><option value="book">书籍影视</option></select
						></label
					>
					<label
						><span>投稿分类</span><select bind:value={categoryId}
							><option value={null}>请选择分类</option
							>{#each availableCategories as category (category.id)}<option value={category.id}
									>{category.name}</option
								>{/each}</select
						><small
							>{suggestion?.categoryId
								? `AI推荐：${suggestion.categoryName} · ${suggestion.categoryReason || '根据网页内容判断'}`
								: '可手动选择；AI识别后会给出推荐。'}</small
						></label
					>
					<label class="account-wide"
						><span>简洁标题</span>
						<div class="field-with-action">
							<input
								bind:value={title}
								maxlength="160"
								required
								placeholder="网页名称"
							/>{#if snapshot}<button type="button" onclick={() => apply('title')}>采用建议</button
								>{/if}
						</div></label
					>
					<label class="account-wide"
						><span>网页介绍</span>
						<div class="field-with-action">
							<textarea
								bind:value={summary}
								rows="4"
								maxlength="500"
								placeholder="客观说明网页提供什么服务"></textarea>{#if snapshot}<button
									type="button"
									onclick={() => apply('summary')}>采用建议</button
								>{/if}
						</div></label
					>
					<label class="account-wide"
						><span>正文或补充说明</span>
						<div class="field-with-action">
							<textarea
								bind:value={content}
								rows="8"
								maxlength="20000"
								placeholder="补充使用场景、特点或推荐理由"></textarea>{#if snapshot}<button
									type="button"
									onclick={() => apply('content')}>采用建议</button
								>{/if}
						</div></label
					>
					<label class="account-wide"
						><span>标签</span><input
							bind:value={tagInput}
							maxlength="240"
							placeholder="用逗号分隔，例如：AI，效率工具，开发"
						/><small>最多8个标签；管理员审核时会匹配已有正式标签，未建立的标签会单独提示。</small
						></label
					>
					{#if tags.length}<div class="tag-preview account-wide">
							{#each tags as tag (tag)}<span>{tag}</span>{/each}
						</div>{/if}
					<div class="account-wide icon-editor">
						<div class="icon-preview">
							{#if iconPreviewUrl}<img src={iconPreviewUrl} alt="当前投稿图标" />{:else}<span
									>无图标</span
								>{/if}
						</div>
						<div>
							<strong>网站图标</strong>
							<p>
								{iconFileId
									? `已选择${iconSource === 'auto' ? '自动抓取' : '手动上传'}图标`
									: '可采用网页图标，或手动上传替换。'}
							</p>
							<div class="icon-actions">
								{#if snapshot?.iconUrl && !iconFileId}<button
										type="button"
										disabled={iconSaving}
										onclick={saveRemoteIcon}>{iconSaving ? '保存中…' : '使用网页图标'}</button
									>{/if}
								<label class="icon-upload"
									><input
										type="file"
										accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/x-icon"
										onchange={uploadIcon}
										disabled={iconSaving}
									/><span>{iconFileId ? '替换图标' : '手动上传'}</span></label
								>
								{#if iconFileId}<button
										type="button"
										onclick={() => {
											iconFileId = null;
											iconSource = null;
											iconPreviewUrl = '';
										}}>清除</button
									>{/if}
							</div>
						</div>
					</div>
					<div class="account-wide account-actions">
						<button class="account-button" type="submit" disabled={submitting}
							>{submitting ? '提交中…' : '提交审核'}</button
						><a class="account-button secondary" href={resolve('/user/submissions')}>投稿记录</a>
					</div>
				</form>
			</section>

			<aside class="account-card suggestion-panel">
				<div class="account-card-header">
					<div>
						<span class="step">AI</span>
						<h2>智能建议</h2>
						<p>{aiMeta.available ? '根据网页内容精炼生成' : '抓取网页原始信息'}</p>
					</div>
					{#if snapshot}<button type="button" class="apply-all" onclick={applyAll}
							><span>✦</span>采用全部可用建议</button
						>{/if}
				</div>
				{#if snapshot}<dl class="suggestion-list">
						<div>
							<dt>原网页</dt>
							<dd>{snapshot.siteName || new URL(snapshot.fetchedUrl).hostname}</dd>
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
						{#if suggestion?.tags.length}<div>
								<dt>建议标签</dt>
								<dd class="tag-preview">
									{#each suggestion.tags as tag (tag)}<span>{tag}</span>{/each}
								</dd>
							</div>{/if}
						{#if suggestion?.categoryId}<div>
								<dt>推荐分类</dt>
								<dd><strong>{suggestion.categoryName}</strong><br />{suggestion.categoryReason}</dd>
							</div>{/if}
						{#if snapshot.iconUrl}<div>
								<dt>网页图标候选</dt>
								<dd class="icon-candidate">
									<img src={snapshot.iconUrl} alt="网页图标候选" /><span>{snapshot.iconUrl}</span>
								</dd>
							</div>{/if}
					</dl>{:else}<div class="suggestion-empty">
						<strong>等待网页分析</strong>
						<p>输入网址后，原始网页信息和AI建议会显示在这里。</p>
					</div>{/if}
				<div class="ai-boundary">
					<strong>AI使用边界</strong>
					<p>AI生成内容可能不准确。系统不会自动提交，也不会覆盖已经填写的字段。</p>
				</div>
			</aside>
		</div>
	</div>
</AccountShell>

<style>
	.contribute-flow {
		display: grid;
		gap: 18px;
	}
	.url-stage {
		background: linear-gradient(135deg, #fff 0%, #fff8f8 100%);
	}
	.step {
		display: inline-grid;
		min-width: 30px;
		height: 24px;
		place-items: center;
		margin-bottom: 8px;
		border-radius: 7px;
		color: #c93f48;
		background: #fff0f1;
		font-size: 10px;
		font-weight: 800;
	}
	.url-command {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 10px;
	}
	.url-command input {
		min-height: 48px;
		border: 1px solid #dddfe3;
		border-radius: 10px;
		padding: 0 14px;
		font: inherit;
	}
	.ai-status {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 12px 0 0;
		color: #6b4b75;
		font-size: 12px;
	}
	.ai-status span {
		color: #9a5bb2;
	}
	.duplicate-warning {
		margin-top: 12px;
		border: 1px solid #f0d4a8;
		border-radius: 10px;
		padding: 10px 12px;
		background: #fff9ef;
		color: #76552d;
		font-size: 11px;
	}
	.duplicate-warning p {
		margin: 4px 0;
	}
	.duplicate-warning small {
		color: #8c775d;
	}
	.contribute-columns {
		display: grid;
		grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.75fr);
		gap: 18px;
		align-items: start;
	}
	.field-with-action {
		position: relative;
	}
	.field-with-action input,
	.field-with-action textarea {
		width: 100%;
		padding-right: 90px;
	}
	.field-with-action button {
		border: 0;
		border-radius: 7px;
		padding: 6px 9px;
		color: #a53d45;
		background: #fff0f1;
		font: inherit;
		font-size: 10px;
		cursor: pointer;
	}
	.apply-all {
		display: inline-flex;
		min-height: 42px;
		align-items: center;
		gap: 7px;
		border: 0;
		border-radius: 10px;
		padding: 0 15px;
		color: #fff;
		background: linear-gradient(135deg, #df3e47, #bd2834);
		box-shadow: 0 7px 18px #d7384340;
		font: inherit;
		font-size: 12px;
		font-weight: 750;
		cursor: pointer;
	}
	.apply-all:hover {
		transform: translateY(-1px);
		box-shadow: 0 9px 22px #d7384352;
	}
	.field-with-action button {
		position: absolute;
		top: 7px;
		right: 7px;
	}
	.tag-preview {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.tag-preview span {
		border-radius: 999px;
		padding: 4px 8px;
		color: #53606f;
		background: #edf1f5;
		font-size: 10px;
	}
	.icon-editor {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr);
		gap: 13px;
		align-items: center;
		border: 1px solid #e5e7ea;
		border-radius: 11px;
		padding: 12px;
	}
	.icon-editor p {
		margin: 3px 0 8px;
		color: #7a7f87;
		font-size: 10px;
	}
	.icon-preview {
		display: grid;
		width: 56px;
		height: 56px;
		place-items: center;
		overflow: hidden;
		border-radius: 12px;
		background: #f1f3f5;
		color: #999;
		font-size: 9px;
	}
	.icon-preview img,
	.icon-candidate img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.icon-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
	}
	.icon-actions button,
	.icon-upload span {
		border: 1px solid #dfe2e6;
		border-radius: 7px;
		padding: 6px 9px;
		background: #fff;
		color: #59606a;
		font: inherit;
		font-size: 10px;
		cursor: pointer;
	}
	.icon-upload input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.icon-candidate {
		display: grid;
		grid-template-columns: 38px minmax(0, 1fr);
		gap: 8px;
		align-items: center;
	}
	.icon-candidate img {
		width: 38px;
		height: 38px;
		border-radius: 8px;
		background: #fff;
	}
	.icon-candidate span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.suggestion-panel {
		position: sticky;
		top: 82px;
	}
	.suggestion-list {
		display: grid;
		gap: 0;
		margin: 0;
	}
	.suggestion-list div {
		padding: 13px 0;
		border-bottom: 1px solid #ececef;
	}
	.suggestion-list dt {
		margin-bottom: 5px;
		color: #999;
		font-size: 10px;
		font-weight: 700;
	}
	.suggestion-list dd {
		margin: 0;
		color: #464950;
		font-size: 12px;
		line-height: 1.65;
	}
	.suggestion-empty {
		display: grid;
		min-height: 220px;
		place-items: center;
		align-content: center;
		color: #888;
		text-align: center;
	}
	.ai-boundary {
		margin-top: 16px;
		border-radius: 10px;
		padding: 12px;
		background: #f7f7f6;
	}
	.ai-boundary strong {
		font-size: 11px;
	}
	.ai-boundary p {
		margin: 5px 0 0;
		color: #777;
		font-size: 10px;
		line-height: 1.6;
	}
	@media (max-width: 900px) {
		.contribute-columns {
			grid-template-columns: 1fr;
		}
		.suggestion-panel {
			position: static;
			grid-row: 1;
		}
		.url-command {
			grid-template-columns: 1fr;
		}
		.apply-all {
			width: 100%;
			justify-content: center;
			margin-top: 10px;
		}
	}
</style>
