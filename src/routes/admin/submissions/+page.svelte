<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	type Submission = PageProps['data']['submissions'][number];
	let selectedId = $state<number | null>(null),
		statusFilter = $state('pending'),
		query = $state(''),
		message = $state(''),
		processing = $state(false);
	const processed = new SvelteSet<number>();
	let initialized = $state(false);
	$effect(() => {
		if (initialized) return;
		selectedId =
			data.submissions.find((entry) => entry.status === 'pending')?.id ??
			data.submissions[0]?.id ??
			null;
		initialized = true;
	});
	let visible = $derived(
		data.submissions.filter(
			(entry) =>
				!processed.has(entry.id) &&
				(statusFilter === 'all' || entry.status === statusFilter) &&
				(!query.trim() ||
					`${entry.title} ${entry.user.displayName} ${entry.payload.url ?? ''}`
						.toLowerCase()
						.includes(query.trim().toLowerCase()))
		)
	);
	let selected = $derived(visible.find((entry) => entry.id === selectedId) ?? visible[0] ?? null);
	function slugify(value: string, url: string | null) {
		const slug = value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 100);
		if (slug) return slug;
		try {
			return new URL(url ?? '').hostname
				.replace(/^www\./, '')
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '')
				.slice(0, 100);
		} catch {
			return `submission-${selectedId ?? 'item'}`;
		}
	}
	function source(submission: Submission, field: 'title' | 'summary' | 'content') {
		const ai = submission.payload.aiSuggestion?.[field];
		if (ai) return ai;
		if (field === 'title') return submission.payload.webSnapshot?.title || submission.title;
		if (field === 'summary')
			return submission.payload.webSnapshot?.description || submission.payload.summary || '';
		return submission.payload.webSnapshot?.excerpt || submission.payload.content || '';
	}
	function tagIds(submission: Submission) {
		const names = (submission.payload.tagNames ?? submission.payload.aiSuggestion?.tags ?? []).map(
			(name) => name.toLocaleLowerCase()
		);
		return names
			.map(
				(name) =>
					data.tags.find(
						(tag) => tag.type === submission.type && tag.name.toLocaleLowerCase() === name
					)?.id
			)
			.filter((id): id is number => Boolean(id))
			.slice(0, 3);
	}
	function suggestedTagNames(submission: Submission) {
		return [
			...new Set(submission.payload.tagNames ?? submission.payload.aiSuggestion?.tags ?? [])
		].slice(0, 8);
	}
	function missingTagNames(submission: Submission) {
		return suggestedTagNames(submission).filter(
			(name) =>
				!data.tags.some(
					(tag) =>
						tag.type === submission.type &&
						tag.name.toLocaleLowerCase() === name.toLocaleLowerCase()
				)
		);
	}
	function defaultCategoryId(submission: Submission) {
		const candidates = [
			submission.payload.userCategoryId,
			submission.payload.aiSuggestion?.categoryId
		];
		return (
			candidates.find((id) =>
				data.categories.some((category) => category.id === id && category.type === submission.type)
			) ?? ''
		);
	}
	function meta(submission: Submission) {
		const url = submission.payload.url;
		if (!url) return {};
		if (submission.type === 'site') return { site_url: url };
		if (submission.type === 'app') return { app_download_url: url };
		if (submission.type === 'book') return { book_download_url: url };
		return {};
	}
	async function review(
		submission: Submission,
		decision: 'approve' | 'reject',
		form: HTMLFormElement
	) {
		if (processing) return;
		const values = new FormData(form),
			rejection = String(values.get('message') ?? '').trim();
		if (decision === 'reject' && !rejection) {
			message = '拒绝投稿时必须填写审核意见。';
			return;
		}
		if (decision === 'reject' && !confirm(`确定拒绝“${submission.title}”吗？`)) return;
		if (decision === 'approve') {
			const category =
					(form.elements.namedItem('categoryId') as HTMLSelectElement | null)?.selectedOptions[0]
						?.textContent ?? '未分类',
				existingTags = values.getAll('tagIds').length,
				newTags = values.getAll('newTagNames').length;
			if (
				!confirm(
					`确认发布“${submission.title}”？\n分类：${category}\n关联已有标签：${existingTags} 个\n创建新标签：${newTags} 个`
				)
			)
				return;
		}
		processing = true;
		message = '';
		try {
			const body =
				decision === 'reject'
					? { decision, message: rejection }
					: {
							decision,
							message: rejection,
							item: {
								type: submission.type,
								title: String(values.get('title') ?? ''),
								slug: String(values.get('slug') ?? ''),
								summary: String(values.get('summary') ?? ''),
								content: String(values.get('content') ?? ''),
								categoryId: values.get('categoryId') ? Number(values.get('categoryId')) : null,
								iconFileId: submission.payload.iconFileId ?? null,
								coverFileId: null,
								status: 'published',
								visibility: 'public',
								sortOrder: Number(values.get('sortOrder') ?? 0),
								isFeatured: values.has('isFeatured'),
								tagIds: values.getAll('tagIds').map(Number),
								meta: meta(submission)
							},
							newTagNames: values.getAll('newTagNames').map(String)
						};
			const response = await fetch(`/api/admin/submissions/${submission.id}/review`, {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body)
				}),
				result = await response.json();
			if (!response.ok) throw new Error(result.error ?? '审核失败。');
			processed.add(submission.id);
			const next = visible.find((entry) => entry.id !== submission.id);
			selectedId = next?.id ?? null;
			message =
				decision === 'approve' ? '投稿已发布，已进入下一条。' : '投稿已拒绝，已进入下一条。';
		} catch (error) {
			message = error instanceof Error ? error.message : '审核失败。';
		} finally {
			processing = false;
		}
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">AI Review Queue</p>
		<h1>投稿审核</h1>
		<span>对比用户提交、网页快照和AI建议，确认后发布。</span>
	</div>
</header>
{#if message}<p class="admin-form-message" role="status">{message}</p>{/if}
{#if data.source === 'fallback'}<p class="admin-notice">数据库不可用，无法审核投稿。</p>{/if}

<div class="review-workbench">
	<aside class="review-queue">
		<div class="review-queue-head"><strong>审核队列</strong><span>{visible.length}</span></div>
		<div class="review-filters">
			<input bind:value={query} placeholder="搜索标题、投稿人或网址" aria-label="搜索投稿" /><select
				bind:value={statusFilter}
				><option value="pending">待审核</option><option value="published">已发布</option><option
					value="rejected">已拒绝</option
				><option value="all">全部</option></select
			>
		</div>
		<div class="review-list">
			{#each visible as submission (submission.id)}<button
					type="button"
					class:active={selected?.id === submission.id}
					onclick={() => (selectedId = submission.id)}
					><span class="review-type">{submission.type}</span><strong>{submission.title}</strong
					><small>{submission.user.displayName} · {submission.createdAt.slice(0, 10)}</small
					>{#if submission.payload.aiSuggestion}<em>✦ AI</em>{/if}</button
				>{:else}<p class="admin-notice">没有匹配投稿。</p>{/each}
		</div>
	</aside>

	<section class="review-detail">
		{#if selected}<div class="review-detail-head">
				<div>
					<p class="eyebrow">Submission #{selected.id}</p>
					<h2>{selected.title}</h2>
					<span>{selected.user.displayName} (@{selected.user.username}) · {selected.createdAt}</span
					>
				</div>
				<span class="status-badge">{selected.status}</span>
			</div>
			{#if selected.payload.url}<a
					class="review-url"
					href={resolve(`/go?url=${encodeURIComponent(selected.payload.url)}`)}
					target="_blank"
					rel="external noopener noreferrer">{selected.payload.url} ↗</a
				>{/if}
			<div class="review-evidence">
				<section>
					<h3>用户最终提交</h3>
					<dl>
						<dt>标题</dt>
						<dd>{selected.title}</dd>
						<dt>简介</dt>
						<dd>{selected.payload.summary || '未填写'}</dd>
						<dt>补充说明</dt>
						<dd>{selected.payload.content || '未填写'}</dd>
						<dt>分类</dt>
						<dd>
							{data.categories.find((category) => category.id === selected.payload.userCategoryId)
								?.name || '未选择'}
						</dd>
						<dt>图标</dt>
						<dd>
							{#if selected.payload.iconFileId}<img
									class="review-icon"
									src={`/api/admin/files/${selected.payload.iconFileId}`}
									alt="投稿图标"
								/>{:else}未选择{/if}
						</dd>
					</dl>
				</section>
				<section>
					<h3>网页原始提取</h3>
					{#if selected.payload.webSnapshot}<dl>
							<dt>原始标题</dt>
							<dd>{selected.payload.webSnapshot.title || '无'}</dd>
							<dt>网页描述</dt>
							<dd>{selected.payload.webSnapshot.description || '无'}</dd>
							<dt>站点</dt>
							<dd>{selected.payload.webSnapshot.siteName || '无'}</dd>
						</dl>{:else}<p>此投稿没有网页快照。</p>{/if}
				</section>
				<section class="ai-evidence">
					<h3>✦ AI建议</h3>
					{#if selected.payload.aiSuggestion}<dl>
							<dt>模型</dt>
							<dd>
								{selected.payload.aiSuggestion.provider} / {selected.payload.aiSuggestion.model}
							</dd>
							<dt>标题</dt>
							<dd>{selected.payload.aiSuggestion.title}</dd>
							<dt>简介</dt>
							<dd>{selected.payload.aiSuggestion.summary}</dd>
							<dt>推荐分类</dt>
							<dd>
								{selected.payload.aiSuggestion.categoryName ||
									'未判断'}{#if selected.payload.aiSuggestion.categoryReason}<br />{selected.payload
										.aiSuggestion.categoryReason}{/if}
							</dd>
							<dt>标签</dt>
							<dd class="suggested-tags">
								{#each selected.payload.aiSuggestion.tags as tag (tag)}<span>{tag}</span>{/each}
							</dd>
						</dl>{:else}<p>未使用AI生成。</p>{/if}
				</section>
			</div>
			{#if selected.status === 'pending'}<form
					class="admin-form review-form"
					onsubmit={(event) => {
						event.preventDefault();
						review(selected!, 'approve', event.currentTarget);
					}}
				>
					<h3>最终发布内容</h3>
					<div class="admin-form-grid">
						<label class="admin-field-wide"
							><span>标题</span><input
								name="title"
								required
								maxlength="160"
								value={source(selected, 'title')}
							/></label
						>
						<label
							><span>Slug</span><input
								name="slug"
								required
								pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
								value={slugify(source(selected, 'title'), selected.payload.url)}
							/></label
						>
						<label
							><span>分类</span><select name="categoryId" value={defaultCategoryId(selected)}
								><option value="">未分类</option
								>{#each data.categories.filter((category) => category.type === selected?.type) as category (category.id)}<option
										value={category.id}>{category.name}</option
									>{/each}</select
							><small
								>{selected.payload.userCategoryId
									? '投稿用户已选择此分类，可手动调整。'
									: selected.payload.aiSuggestion?.categoryId
										? `AI推荐：${selected.payload.aiSuggestion.categoryName} · ${selected.payload.aiSuggestion.categoryReason}`
										: '未提供分类建议，请手动选择。'}</small
							></label
						>
						<label class="admin-field-wide"
							><span>简介</span><textarea name="summary" maxlength="500" rows="3"
								>{source(selected, 'summary')}</textarea
							></label
						>
						<label class="admin-field-wide"
							><span>正文或补充说明</span><textarea name="content" maxlength="100000" rows="7"
								>{source(selected, 'content')}</textarea
							></label
						>
						<label><span>排序</span><input name="sortOrder" type="number" value="0" /></label><label
							class="admin-checkbox"
							><input name="isFeatured" type="checkbox" /><span>设为推荐</span></label
						>
					</div>
					<fieldset class="admin-form-section">
						<legend>正式标签</legend>
						<p class="admin-form-hint">与建议同名的已有标签最多自动勾选3个；其余可手动追加。</p>
						<div class="admin-check-grid">
							{#each data.tags.filter((tag) => tag.type === selected?.type) as tag (tag.id)}<label
									><input
										type="checkbox"
										name="tagIds"
										value={tag.id}
										checked={tagIds(selected).includes(tag.id)}
									/><span>{tag.name}</span></label
								>{/each}
						</div>
						{#if missingTagNames(selected).length}<div class="new-tag-options">
								<strong>建议中的新标签</strong>
								<p>勾选后将在“审核通过并发布”时创建；不勾选不会进入标签库。</p>
								<div class="admin-check-grid">
									{#each missingTagNames(selected) as name (name)}<label class="new-tag-option"
											><input type="checkbox" name="newTagNames" value={name} /><span
												>{name}<em>发布时创建</em></span
											></label
										>{/each}
								</div>
							</div>{/if}
					</fieldset>
					<label
						><span>审核意见</span><textarea
							name="message"
							rows="3"
							placeholder="通过时可选；拒绝时必填"></textarea></label
					>
					<div class="admin-form-actions">
						<button class="admin-primary-button" type="submit" disabled={processing}
							>{processing ? '处理中…' : '审核通过并发布'}</button
						><button
							class="admin-secondary-button"
							type="button"
							disabled={processing}
							onclick={(event) => {
								const form = event.currentTarget.form;
								if (form) review(selected!, 'reject', form);
							}}>拒绝投稿</button
						>
					</div>
				</form>{:else}<p class="admin-notice">审核意见：{selected.reviewMessage ?? '无'}</p>{/if}
		{:else}<div class="review-empty">
				<strong>没有待处理投稿</strong>
				<p>调整左侧筛选条件查看历史记录。</p>
			</div>{/if}
	</section>
</div>

<style>
	.review-workbench {
		display: grid;
		grid-template-columns: 320px minmax(0, 1fr);
		gap: 16px;
		align-items: start;
	}
	.review-queue,
	.review-detail {
		border: 1px solid #e3e5e8;
		border-radius: 14px;
		background: #fff;
		box-shadow: 0 8px 28px #20242b0a;
	}
	.review-queue {
		position: sticky;
		top: 80px;
		overflow: hidden;
	}
	.review-queue-head,
	.review-detail-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 18px;
		border-bottom: 1px solid #eceef0;
	}
	.review-queue-head span {
		border-radius: 999px;
		padding: 3px 8px;
		background: #eff1f4;
		font-size: 11px;
	}
	.review-filters {
		display: grid;
		gap: 8px;
		padding: 12px;
		border-bottom: 1px solid #eceef0;
	}
	.review-filters input,
	.review-filters select {
		min-height: 36px;
		border: 1px solid #dfe2e6;
		border-radius: 8px;
		padding: 0 10px;
		font: inherit;
	}
	.review-list {
		display: grid;
		max-height: calc(100vh - 250px);
		overflow: auto;
	}
	.review-list button {
		position: relative;
		display: grid;
		gap: 5px;
		border: 0;
		border-bottom: 1px solid #f0f1f2;
		padding: 13px 15px;
		background: #fff;
		text-align: left;
		cursor: pointer;
	}
	.review-list button:hover,
	.review-list button.active {
		background: #f7f8fa;
	}
	.review-list button.active {
		box-shadow: inset 3px 0 #e5484d;
	}
	.review-list strong {
		padding-right: 46px;
		font-size: 12px;
	}
	.review-list small {
		color: #92969e;
		font-size: 10px;
	}
	.review-list em {
		position: absolute;
		top: 13px;
		right: 12px;
		color: #8a55a2;
		font-size: 9px;
		font-style: normal;
	}
	.review-type {
		color: #9b6a40;
		font-size: 9px;
		text-transform: uppercase;
	}
	.review-detail {
		overflow: hidden;
	}
	.review-detail-head h2 {
		margin: 3px 0;
		font-size: 20px;
	}
	.review-detail-head span {
		color: #8b9098;
		font-size: 10px;
	}
	.review-url {
		display: block;
		margin: 14px 18px 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #596778;
		font-size: 11px;
	}
	.review-evidence {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		padding: 16px 18px;
	}
	.review-evidence section {
		border: 1px solid #e8eaed;
		border-radius: 10px;
		padding: 13px;
		background: #fbfbfc;
	}
	.review-evidence section.ai-evidence {
		border-color: #eadcf0;
		background: #fcf8fe;
	}
	.review-evidence h3 {
		margin: 0 0 10px;
		font-size: 12px;
	}
	.review-evidence dl {
		display: grid;
		gap: 4px;
		margin: 0;
	}
	.review-evidence dt {
		margin-top: 7px;
		color: #999;
		font-size: 9px;
		font-weight: 700;
	}
	.review-evidence dd {
		margin: 0;
		color: #50545b;
		font-size: 10px;
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
		background: #eee7f2;
	}
	.review-icon {
		width: 44px;
		height: 44px;
		border-radius: 9px;
		background: #fff;
		object-fit: contain;
	}
	.new-tag-options {
		margin-top: 14px;
		border-top: 1px dashed #dfe2e6;
		padding-top: 12px;
	}
	.new-tag-options > p {
		margin: 4px 0 10px;
		color: #7b8088;
		font-size: 10px;
	}
	.new-tag-option em {
		display: block;
		color: #a16a39;
		font-size: 8px;
		font-style: normal;
	}
	.review-form {
		border: 0;
		border-top: 1px solid #e8eaed;
		border-radius: 0;
		padding: 18px;
		box-shadow: none;
	}
	.review-form > h3 {
		margin-top: 0;
	}
	.review-empty {
		display: grid;
		min-height: 480px;
		place-items: center;
		align-content: center;
		color: #888;
		text-align: center;
	}
	@media (max-width: 1000px) {
		.review-workbench {
			grid-template-columns: 1fr;
		}
		.review-queue {
			position: static;
		}
		.review-list {
			max-height: 320px;
		}
		.review-evidence {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 600px) {
		.review-evidence {
			padding: 12px;
		}
		.review-detail-head {
			align-items: flex-start;
			gap: 10px;
		}
		.review-form {
			padding: 14px;
		}
	}
</style>
