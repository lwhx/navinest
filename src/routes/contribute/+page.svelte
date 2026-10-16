<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import CategoryParentPicker from '$lib/components/admin/CategoryParentPicker.svelte';
	import { categoryParentPath } from '$lib/category-parent-selection';
	import type { ContributionType } from '$lib/contribution-types';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
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
	type Draft = {
		title: string;
		summary: string;
		content: string;
		url: string;
		categoryId: string;
		tagInput: string;
		iconFileId: number | null;
		iconSource: 'auto' | 'manual' | null;
		iconPreviewUrl: string;
		snapshot: Snapshot | null;
		suggestion: Suggestion | null;
		ai: { available: boolean; provider?: string; model?: string };
		duplicate: { published: string[]; pendingCount: number };
		enrichStage: string;
	};
	function blank(values: Record<string, string> = {}): Draft {
		return {
			title: values.title ?? '',
			summary: values.summary ?? '',
			content: values.content ?? '',
			url: values.url ?? '',
			categoryId: values.userCategoryId ?? '',
			tagInput: values.tagInput ?? '',
			iconFileId: Number(values.iconFileId) || null,
			iconSource:
				values.iconSource === 'auto' || values.iconSource === 'manual' ? values.iconSource : null,
			iconPreviewUrl: Number(values.iconFileId)
				? resolve(`/api/user/files/${Number(values.iconFileId)}` as '/')
				: '',
			snapshot: null,
			suggestion: null,
			ai: { available: false },
			duplicate: { published: [], pendingCount: 0 },
			enrichStage: ''
		};
	}
	let drafts = $state<Record<ContributionType, Draft>>(
		untrack(() => ({
			site: blank(
				form?.values?.type === 'site'
					? form.values
					: data.resubmission?.draft?.type === 'site'
						? data.resubmission.draft
						: undefined
			),
			post: blank(
				form?.values?.type === 'post'
					? form.values
					: data.resubmission?.draft?.type === 'post'
						? data.resubmission.draft
						: undefined
			)
		}))
	);
	let sourceId = $derived(data.resubmission?.source.id ?? null);
	let initialSourceId = $state(untrack(() => sourceId));
	$effect(() => {
		const current = sourceId;
		if (untrack(() => initialSourceId) !== current)
			untrack(() => {
				drafts = {
					site: blank(
						data.resubmission?.draft?.type === 'site' ? data.resubmission.draft : undefined
					),
					post: blank(
						data.resubmission?.draft?.type === 'post' ? data.resubmission.draft : undefined
					)
				};
				message = '';
				fields = {};
				initialSourceId = current;
			});
	});
	let type = $derived(data.contributionType);
	let draft = $derived(drafts[type]);
	let availableCategories = $derived(data.categories.filter((category) => category.type === type));
	let snapshot = $derived(draft.snapshot),
		suggestion = $derived(draft.suggestion);
	let submitting = $state(false),
		enriching = $state(false),
		iconSaving = $state(false),
		submitted = $state(false);
	let busy = $derived(submitting || enriching || iconSaving);
	let message = $state(untrack(() => form?.message ?? ''));
	let fields = $state<Record<string, string>>(untrack(() => form?.fields ?? {}));
	let formElement = $state<HTMLFormElement | null>(null);
	const uid = $props.id();
	let tags = $derived(
		[
			...new Set(
				draft.tagInput
					.split(/[，,\n]/)
					.map((tag) => tag.trim())
					.filter(Boolean)
			)
		].slice(0, 8)
	);
	beforeNavigate(({ cancel }) => {
		if (busy && !submitted) cancel();
	});

	function categoryLabel(id: number | null | undefined) {
		return id
			? categoryParentPath(availableCategories, String(id))
					?.map((part) => part.name)
					.join(' / ')
			: undefined;
	}
	function apply(field: 'title' | 'summary' | 'content') {
		draft[field] =
			suggestion?.[field] ??
			(field === 'title'
				? snapshot?.title
				: field === 'summary'
					? snapshot?.description
					: snapshot?.excerpt) ??
			'';
	}
	function applyAll() {
		for (const field of ['title', 'summary', 'content'] as const)
			if (!draft[field].trim()) apply(field);
		if (!draft.tagInput.trim() && suggestion?.tags?.length)
			draft.tagInput = suggestion.tags.join('，');
		if (!draft.categoryId && categoryLabel(suggestion?.categoryId))
			draft.categoryId = String(suggestion?.categoryId);
	}
	function changeUrl(value: string) {
		draft.url = value;
		draft.snapshot = null;
		draft.suggestion = null;
		draft.ai = { available: false };
		draft.duplicate = { published: [], pendingCount: 0 };
		draft.enrichStage = '';
		if (draft.iconSource === 'auto') {
			draft.iconFileId = null;
			draft.iconSource = null;
			draft.iconPreviewUrl = '';
		}
	}
	async function enrich() {
		if (busy) return;
		if (!draft.url.trim()) {
			message = '请先输入网页地址。';
			return;
		}
		enriching = true;
		message = '';
		draft.enrichStage = '正在读取网页信息…';
		try {
			const response = await fetch('/api/submissions/enrich', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: draft.url, type })
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? '智能获取失败，请手动填写。');
			draft.snapshot = body.snapshot;
			draft.suggestion = body.suggestion;
			draft.ai = body.ai;
			draft.duplicate = body.duplicate ?? { published: [], pendingCount: 0 };
			draft.enrichStage = body.ai.available
				? '网页信息和 AI 建议已就绪。'
				: '网页信息已读取，可继续手动完善。';
			applyAll();
		} catch (error) {
			message = error instanceof Error ? error.message : '智能获取失败，请手动填写。';
			draft.enrichStage = '';
		} finally {
			enriching = false;
		}
	}
	async function saveRemoteIcon() {
		if (!snapshot?.iconUrl || busy) return;
		iconSaving = true;
		message = '';
		try {
			const response = await fetch('/api/submissions/icon', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: snapshot.iconUrl })
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? '图标保存失败。');
			draft.iconFileId = body.data.id;
			draft.iconSource = 'auto';
			draft.iconPreviewUrl = body.data.previewUrl;
		} catch (error) {
			message = error instanceof Error ? error.message : '图标保存失败。';
		} finally {
			iconSaving = false;
		}
	}
	async function uploadIcon(event: Event) {
		const input = event.currentTarget as HTMLInputElement,
			file = input.files?.[0];
		if (!file || busy) return;
		iconSaving = true;
		message = '';
		try {
			const payload = new FormData();
			payload.set('file', file);
			const response = await fetch('/api/user/files', { method: 'POST', body: payload });
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? '图标上传失败。');
			draft.iconFileId = body.data.id;
			draft.iconSource = 'manual';
			draft.iconPreviewUrl = `/api/user/files/${body.data.id}`;
		} catch (error) {
			message = error instanceof Error ? error.message : '图标上传失败。';
		} finally {
			iconSaving = false;
			input.value = '';
		}
	}
	async function submit() {
		if (busy) return;
		submitting = true;
		message = '';
		fields = {};
		try {
			const aiSuggestion =
				suggestion && draft.ai.available
					? {
							...suggestion,
							provider: draft.ai.provider ?? '',
							model: draft.ai.model ?? '',
							generatedAt: new Date().toISOString()
						}
					: null;
			const response = await fetch('/api/submissions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sourceSubmissionId: sourceId,
					type,
					title: draft.title,
					summary: draft.summary,
					content: draft.content,
					url: draft.url,
					userCategoryId: draft.categoryId ? Number(draft.categoryId) : null,
					iconFileId: draft.iconFileId,
					iconSource: draft.iconSource,
					tagNames: tags,
					webSnapshot: snapshot,
					aiSuggestion
				})
			});
			const body = await response.json();
			if (!response.ok) {
				if (body.field) fields = { [body.field]: body.error };
				throw new Error(body.error ?? '投稿失败。');
			}
			submitted = true;
			location.href = sourceId
				? resolve(`/user/submissions?submission=${body.id}#submission-detail` as '/')
				: resolve('/user/submissions');
		} catch (error) {
			message = error instanceof Error ? error.message : '提交结果未确认，请先查看投稿记录核对。';
			submitting = false;
			await tick();
			formElement?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head
	><title>{type === 'site' ? '推荐网址' : '提交文章'} | NaviNest 导航巢</title></svelte:head
>
<AccountShell
	title={type === 'site' ? '推荐网址' : '提交文章'}
	description={type === 'site'
		? '推荐值得收藏的网站，确认信息后提交审核。'
		: '分享你的经验与发现，填写正文后提交审核。'}
	eyebrow="CONTRIBUTE"
>
	{#if data.resubmission}<section class="account-card resubmission-note" aria-label="修改重投说明">
			<h2>修改投稿 #{data.resubmission.source.id}</h2>
			<p>审核意见：{data.resubmission.source.reviewMessage || '暂无审核意见。'}</p>
			{#if data.resubmission.draft}<p>原内容已带入。修改后会生成新投稿，原记录和审核意见保留。</p>
				{#if data.resubmission.source.categoryId && !data.resubmission.source.categoryPath}<p>
						原分类已不可用，已清空，请重新选择。
					</p>{/if}
				{#if data.resubmission.source.iconFileId && !data.resubmission.source.iconAvailable}<p>
						原图标已不可用，已移除，可重新上传。
					</p>{/if}
			{:else}<p>这条投稿当前不可重投，或已经生成了修改后的投稿。</p>{/if}
			<div class="account-actions">
				<a
					class="account-button secondary"
					href={resolve(
						`/user/submissions?submission=${data.resubmission.source.childId ?? data.resubmission.source.id}#submission-detail` as '/'
					)}>{data.resubmission.source.childId ? '查看重投记录' : '返回原投稿'}</a
				><a class="account-button secondary" href={resolve('/contribute')}>新建其他投稿</a>
			</div>
		</section>{/if}
	{#if data.submissionsOpen && (!data.resubmission || data.resubmission.draft)}
		{#if !data.resubmission}<div class="contribution-types" role="group" aria-label="投稿类型">
				{#each [{ value: 'site', label: '网址', description: '收录网站与在线工具' }, { value: 'post', label: '文章', description: '分享正文与阅读内容' }] as option (option.value)}
					<a
						href={resolve(`/contribute?type=${option.value}`)}
						aria-current={type === option.value ? 'page' : undefined}
						aria-disabled={busy || undefined}
						onclick={(event) => {
							if (busy) event.preventDefault();
							else {
								message = '';
								fields = {};
							}
						}}><strong>{option.label}</strong><span>{option.description}</span></a
					>
				{/each}
			</div>{/if}
		<form
			class="contribute-flow"
			method="POST"
			bind:this={formElement}
			onsubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<input type="hidden" name="type" value={type} />
			<input type="hidden" name="sourceSubmissionId" value={sourceId ?? ''} />
			<input type="hidden" name="iconFileId" value={draft.iconFileId ?? ''} />
			<input type="hidden" name="iconSource" value={draft.iconSource ?? ''} />
			<fieldset class="flow-fields" disabled={submitting}>
				<legend class="sr-only">{type === 'site' ? '网址投稿内容' : '文章投稿内容'}</legend>
				{#if message}<p class="contribution-message" role="alert">{message}</p>{/if}
				{#if type === 'site'}<section class="account-card url-stage">
						<h2>先填写网址</h2>
						<p>可智能读取网页信息，也可以直接手动填写。</p>
						{@render urlInput(true)}
					</section>{/if}
				<div class="contribute-columns">
					<section class="account-card">
						<div class="account-card-header">
							<div>
								<h2>{type === 'site' ? '完善收录信息' : '撰写文章'}</h2>
								<p>
									{type === 'site'
										? '用简洁文字说明网站能做什么。'
										: '标题与正文必填，摘要和参考网址可稍后补充。'}
								</p>
							</div>
						</div>
						<div class="account-form">
							<div class="account-wide contribution-field">
								<label for={`${uid}-title`}>标题</label>
								<div class="field-with-action">
									<input
										id={`${uid}-title`}
										name="title"
										bind:value={draft.title}
										required
										maxlength="160"
										placeholder={type === 'site' ? '网站或工具名称' : '为文章写一个清晰的标题'}
										aria-invalid={fields.title ? true : undefined}
										aria-describedby={fields.title ? `${uid}-title-error` : undefined}
									/>{#if snapshot}<button
											type="button"
											disabled={busy}
											onclick={() => apply('title')}
											aria-label="采用建议标题">采用建议</button
										>{/if}
								</div>
								{@render fieldError('title')}
							</div>
							<div class="account-wide contribution-field">
								<label for={`${uid}-summary`}>{type === 'site' ? '网址简介' : '摘要（选填）'}</label
								>
								<div class="field-with-action">
									<textarea
										id={`${uid}-summary`}
										name="summary"
										bind:value={draft.summary}
										rows="3"
										maxlength="500"
										placeholder={type === 'site'
											? '介绍主要用途、特点或适用人群'
											: '用几句话概括文章内容'}
										aria-invalid={fields.summary ? true : undefined}
									></textarea>{#if snapshot}<button
											type="button"
											disabled={busy}
											onclick={() => apply('summary')}
											aria-label="采用建议简介">采用建议</button
										>{/if}
								</div>
								{@render fieldError('summary')}
							</div>
							<div class="account-wide contribution-field">
								<label for={`${uid}-content`}>{type === 'post' ? '正文' : '补充说明（选填）'}</label
								>
								<div class="field-with-action">
									<textarea
										id={`${uid}-content`}
										name="content"
										bind:value={draft.content}
										rows={type === 'post' ? 14 : 5}
										required={type === 'post'}
										maxlength="20000"
										placeholder={type === 'post' ? '在这里填写文章正文…' : '补充使用场景或推荐理由'}
										aria-invalid={fields.content ? true : undefined}
										aria-describedby={fields.content ? `${uid}-content-error` : undefined}
									></textarea>{#if snapshot}<button
											type="button"
											disabled={busy}
											onclick={() => apply('content')}
											aria-label="采用建议正文">采用建议</button
										>{/if}
								</div>
								{@render fieldError('content')}
							</div>
							<div class="account-wide contribution-categories">
								<h3>投稿分类</h3>
								<CategoryParentPicker
									categories={availableCategories}
									{type}
									purpose="content"
									bind:value={draft.categoryId}
									error={fields.userCategoryId}
								/>{#if categoryLabel(suggestion?.categoryId)}<p class="field-hint">
										AI 推荐：{categoryLabel(suggestion?.categoryId)}
									</p>{/if}
							</div>
							{#if type === 'post'}<details
									class="account-wide reference-source"
									open={Boolean(draft.url) || Boolean(fields.url)}
								>
									<summary>参考网址与智能建议（选填）</summary>
									<p>可以引用原文地址；文章也可直接填写并提交。</p>
									{@render urlInput(false)}
								</details>{/if}
							<label class="account-wide"
								><span>标签（选填）</span><input
									name="tagInput"
									bind:value={draft.tagInput}
									maxlength="240"
									placeholder="用逗号分隔，例如：开发，效率工具"
								/><small>最多 8 个标签，提交后由管理员确认。</small></label
							>
							{#if tags.length}<div class="tag-preview account-wide">
									{#each tags as tag (tag)}<span>{tag}</span>{/each}
								</div>{/if}
							<div class="icon-editor account-wide">
								<div class="icon-preview">
									{#if draft.iconPreviewUrl}<img
											src={draft.iconPreviewUrl}
											alt="当前投稿图标"
										/>{:else}<span>图标</span>{/if}
								</div>
								<div>
									<strong>图标（选填）</strong>
									<p>
										{draft.iconFileId
											? '已选择图标，可替换或移除。'
											: '可采用网页图标，或手动上传。'}
									</p>
									<div class="icon-actions">
										{#if snapshot?.iconUrl && !draft.iconFileId}<button
												type="button"
												disabled={busy}
												onclick={saveRemoteIcon}>使用网页图标</button
											>{/if}<label class="icon-upload"
											><input
												type="file"
												accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/x-icon"
												aria-label="手动上传图标"
												onchange={uploadIcon}
												disabled={busy}
											/><span>{iconSaving ? '保存中…' : '手动上传'}</span></label
										>{#if draft.iconFileId}<button
												type="button"
												disabled={busy}
												onclick={() => {
													draft.iconFileId = null;
													draft.iconSource = null;
													draft.iconPreviewUrl = '';
												}}>移除图标</button
											>{/if}
									</div>
									{@render fieldError('iconFileId')}
								</div>
							</div>
							<div class="account-wide account-actions">
								<button class="account-button contribute-primary" type="submit" disabled={busy}
									>{submitting ? '提交中…' : '提交审核'}</button
								><a class="account-button secondary" href={resolve('/user/submissions')}
									>查看投稿记录</a
								>
							</div>
						</div>
					</section>
					<aside class="account-card suggestion-panel" aria-label="智能建议">
						<div class="account-card-header">
							<div>
								<h2>智能建议</h2>
								<p>
									{draft.ai.available
										? '根据参考网页整理，采用前请核对。'
										: '网页读取是辅助步骤，可随时手动填写。'}
								</p>
							</div>
						</div>
						{#if snapshot}<button class="apply-all" type="button" disabled={busy} onclick={applyAll}
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
				</div>
			</fieldset>
		</form>
	{:else if !data.submissionsOpen}<section class="account-card">
			<h2>投稿暂未开放</h2>
			<p>管理员已暂停接收新的投稿，请稍后再来。</p>
		</section>{/if}
</AccountShell>

{#snippet fieldError(name: string)}{#if fields[name]}<small
			id={`${uid}-${name}-error`}
			class="field-error"
			role="alert">{fields[name]}</small
		>{/if}{/snippet}
{#snippet urlInput(required: boolean)}
	<div class="url-command">
		<label for={`${uid}-url`}
			><span>{required ? '网页地址' : '参考网址'}</span><input
				id={`${uid}-url`}
				name="url"
				type="url"
				value={draft.url}
				oninput={(event) => changeUrl(event.currentTarget.value)}
				{required}
				maxlength="2048"
				placeholder="https://example.com"
				disabled={enriching || iconSaving}
				aria-invalid={fields.url ? true : undefined}
				aria-describedby={fields.url ? `${uid}-url-error` : undefined}
			/></label
		><button type="button" class="account-button secondary" disabled={busy} onclick={enrich}
			>{enriching ? '正在读取…' : '智能获取网页信息'}</button
		>
	</div>
	{@render fieldError('url')}
	{#if draft.enrichStage}<p class="field-hint" role="status">{draft.enrichStage}</p>{/if}
	{#if draft.duplicate.published.length || draft.duplicate.pendingCount}<div
			class="duplicate-warning"
			role="status"
		>
			<strong>发现可能的重复链接</strong>{#if draft.duplicate.published.length}<p>
					已收录：{draft.duplicate.published.join('、')}
				</p>{/if}{#if draft.duplicate.pendingCount}<p>
					另有 {draft.duplicate.pendingCount} 条投稿正在等待处理。
				</p>{/if}
			<p>可先搜索确认，管理员会在审核时判断。</p>
		</div>{/if}
{/snippet}

<style>
	.resubmission-note {
		color: var(--ui-text);
		background: var(--ui-surface);
		border-color: var(--ui-line);
		overflow-wrap: anywhere;
	}
	.resubmission-note h2 {
		color: var(--ui-heading);
		font-size: 18px;
	}
	.resubmission-note p {
		font-size: 15px;
		line-height: 1.8;
		white-space: pre-wrap;
	}
	.resubmission-note .account-button {
		min-height: 44px;
		font-size: 13px;
		color: var(--ui-text);
		background: var(--ui-soft);
		border-color: var(--ui-line);
	}
	.contribute-flow,
	.flow-fields {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.flow-fields {
		display: grid;
		gap: 18px;
	}
	.contribution-types {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.contribution-types a {
		display: grid;
		min-height: 76px;
		gap: 6px;
		padding: 16px;
		border: 1px solid var(--ui-line);
		border-radius: 12px;
		background: var(--ui-surface);
		color: var(--ui-text);
	}
	.contribution-types a[aria-current] {
		border-color: var(--ui-accent);
		background: var(--ui-accent-soft);
	}
	.contribution-types strong {
		color: var(--ui-heading);
		font-size: 16px;
	}
	.contribution-types span {
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.6;
	}
	.contribute-columns {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(260px, 0.75fr);
		gap: 18px;
		align-items: start;
	}
	.contribution-field {
		display: grid;
		min-width: 0;
		gap: 8px;
	}
	.contribution-field > label {
		font-size: 15px;
		font-weight: 600;
		color: var(--ui-text);
	}
	.field-with-action {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		align-items: start;
	}
	.contribute-flow :global(input),
	.contribute-flow :global(select),
	.contribute-flow textarea {
		min-height: 44px;
		min-width: 0;
		max-width: 100%;
		font-size: 15px;
	}
	.contribute-flow button,
	.contribute-flow .account-button,
	.icon-upload span {
		min-height: 44px;
		font-size: 13px;
	}
	.field-with-action button,
	.icon-actions button,
	.apply-all,
	.icon-upload span {
		border: 1px solid var(--ui-line);
		border-radius: 8px;
		padding: 10px 12px;
		color: var(--ui-text);
		background: var(--ui-soft);
		font: inherit;
		cursor: pointer;
	}
	.contribute-primary {
		background: var(--ui-accent);
		color: var(--ui-on-accent);
	}
	.contribution-categories {
		min-width: 0;
	}
	.contribution-categories h3 {
		font-size: 15px;
		margin: 0 0 10px;
	}
	.contribution-categories :global(label) {
		display: grid;
		gap: 8px;
		color: var(--ui-text);
		font-size: 13px;
	}
	.contribution-categories :global(.parent-selection-levels label) {
		flex-basis: 160px;
	}
	.contribution-message,
	.field-error,
	.contribution-categories :global(.field-error) {
		color: var(--ui-error);
		font-size: 13px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.contribution-message {
		margin: 0;
		border: 1px solid var(--ui-accent);
		padding: 12px 16px;
		background: var(--ui-accent-soft);
		border-radius: 10px;
	}
	.contribute-flow :global([aria-invalid='true']) {
		border-color: var(--ui-error);
	}
	.account-card-header p,
	.account-form small:not(.field-error),
	.url-stage > p,
	.field-hint,
	.reference-source > p,
	.icon-editor p,
	.suggestion-empty p,
	.ai-boundary p {
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.7;
	}
	.url-stage h2 {
		font-size: 20px;
	}
	.url-command {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: end;
		gap: 10px;
		margin-top: 16px;
	}
	.url-command label {
		display: grid;
		gap: 8px;
		color: var(--ui-text);
		font-size: 13px;
	}
	.url-command input {
		width: 100%;
		border: 1px solid var(--ui-line);
		padding: 10px 12px;
		border-radius: 8px;
		color: var(--ui-text);
		background: var(--ui-surface);
		font: inherit;
	}
	.duplicate-warning {
		margin-top: 12px;
		padding: 12px;
		border: 1px solid var(--ui-line);
		border-radius: 8px;
		color: var(--ui-text);
		background: var(--ui-soft);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.duplicate-warning p {
		margin: 6px 0;
		line-height: 1.6;
	}
	.reference-source {
		min-width: 0;
		border: 1px solid var(--ui-line);
		border-radius: 10px;
		padding: 12px;
	}
	.reference-source summary {
		display: flex;
		min-height: 44px;
		align-items: center;
		color: var(--ui-text);
		font-weight: 600;
		cursor: pointer;
	}
	.tag-preview,
	.icon-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.tag-preview span {
		max-width: 100%;
		overflow-wrap: anywhere;
		padding: 5px 10px;
		border-radius: 8px;
		background: var(--ui-soft);
		color: var(--ui-text);
		font-size: 13px;
	}
	.icon-editor {
		display: grid;
		grid-template-columns: 56px minmax(0, 1fr);
		gap: 12px;
		align-items: start;
		padding: 12px;
		border: 1px solid var(--ui-line);
		border-radius: 10px;
	}
	.icon-editor strong {
		color: var(--ui-text);
		font-size: 15px;
	}
	.icon-editor p {
		margin: 6px 0;
	}
	.icon-preview {
		display: grid;
		width: 56px;
		height: 56px;
		place-items: center;
		background: var(--ui-soft);
		color: var(--ui-muted);
		border-radius: 10px;
		font-size: 13px;
	}
	.icon-preview img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.icon-upload {
		position: relative;
		display: inline-flex;
		cursor: pointer;
	}
	.icon-upload input {
		position: absolute;
		width: 1px;
		height: 1px;
		min-height: 0;
		opacity: 0;
	}
	.icon-upload:focus-within {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
		border-radius: 8px;
	}
	.icon-upload span {
		display: inline-flex;
		align-items: center;
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
	@media (max-width: 1000px) {
		.contribute-columns {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 600px) {
		.url-command,
		.field-with-action {
			grid-template-columns: 1fr;
		}
		.contribution-types a {
			padding: 12px;
		}
		.account-actions > * {
			flex: 1 1 160px;
		}
	}
</style>
