<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto, beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		submissionStatuses,
		submissionQueueUrl,
		validReviewKey,
		type ReviewAttempt,
		type ReviewReceipt
	} from '$lib/submission-queue';
	import type { PageProps } from './$types';
	let { data: initialData, form }: PageProps = $props();
	let queueSnapshot = $state<{ url: string; data: PageProps['data'] } | null>(null);
	let data = $derived(
		queueSnapshot?.url === page.url.pathname + page.url.search ? queueSnapshot.data : initialData
	);
	let queueReadError = $state(''),
		requestError = $state('');
	type Submission = PageProps['data']['submissions'][number];
	type Draft = {
		url: string;
		title: string;
		slug: string;
		summary: string;
		content: string;
		categoryId: string;
		sortOrder: string;
		isFeatured: boolean;
		tagIds: string[];
		newTagNames: string[];
		message: string;
	};
	type Pending = ReviewAttempt & { id: number; decision: 'approve' | 'reject'; draft?: Draft };
	type Outcome = {
		id: number;
		title: string;
		status: string;
		processing: boolean;
		receipt: ReviewReceipt | null;
		reviewMessage: string | null;
		publishedHref: string | null;
		publishedTitle: string | null;
		updatedAt: string;
	};
	let message = $state(''),
		localFields = $state<Record<string, string> | null>(null),
		processing = $state(false),
		syncing = $state(false),
		checking = $state(false),
		pending = $state<Pending | null>(null),
		cancelAvailable = $state(false);
	let lastResult = $state<Outcome | null>(null),
		lastKnown = $state<Submission | null>(null),
		drafts = $state<Record<string, Draft>>({}),
		formElement = $state<HTMLFormElement | null>(null);
	let selected = $derived(data.selected ?? (data.source === 'unavailable' ? lastKnown : null));
	let visible = $derived(data.submissions);
	let result = $derived(lastResult ?? data.completed);
	let fieldSubmissionId = $state<number | null>(null);
	let fields = $derived(
		fieldSubmissionId === selected?.id
			? (localFields ?? {})
			: form?.id === selected?.id
				? (form?.fields ?? {})
				: {}
	);
	let locked = $derived(
		processing ||
			syncing ||
			pending !== null ||
			queueReadError !== '' ||
			data.source !== 'database' ||
			!data.reviewActorId
	);
	$effect(() => {
		void initialData;
		queueSnapshot = null;
		queueReadError = '';
	});
	$effect(() => {
		if (data.selected) lastKnown = data.selected;
	});
	beforeNavigate(({ cancel, type }) => {
		if (type !== 'leave' && (processing || pending)) cancel();
	});
	const typeLabels: Record<string, string> = {
		site: '网址',
		post: '文章',
		app: '软件',
		book: '书籍',
		bulletin: '公告'
	};
	let urlField = $derived(
		selected?.type === 'site'
			? 'site_url'
			: selected?.type === 'app'
				? 'app_download_url'
				: selected?.type === 'book'
					? 'book_download_url'
					: ''
	);
	const label = (status: string) =>
		Object.hasOwn(submissionStatuses, status)
			? submissionStatuses[status as keyof typeof submissionStatuses]
			: '未知状态';
	const storageKey = () => `navinest.review.pending.${data.reviewActorId}`;
	function storePending(value: Pending | null) {
		try {
			if (value) sessionStorage.setItem(storageKey(), JSON.stringify(value));
			else sessionStorage.removeItem(storageKey());
		} catch {
			/* In-memory locking and server receipts still protect the current page. */
		}
	}
	let pollTimer: ReturnType<typeof setTimeout> | undefined,
		alive = true,
		polls = 0;
	onMount(() => {
		try {
			const value: unknown = JSON.parse(sessionStorage.getItem(storageKey()) ?? 'null');
			if (value && typeof value === 'object') {
				const record = value as Pending;
				if (
					Number.isSafeInteger(record.id) &&
					record.id > 0 &&
					validReviewKey(record.key) &&
					(record.previousKey === '' || validReviewKey(record.previousKey)) &&
					['approve', 'reject'].includes(record.decision)
				) {
					pending = record;
					if (record.draft && validDraft(record.draft)) drafts[record.id] = record.draft;
					void checkOutcome();
				}
			}
		} catch {
			/* Ignore unrelated/invalid browser state. */
		}
		return () => {
			alive = false;
			clearTimeout(pollTimer);
		};
	});
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
			return `submission-${selected?.id ?? 'item'}`;
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
		if (submission.payload.userCategoryId) return submission.payload.userCategoryId;
		const candidates = [submission.payload.aiSuggestion?.categoryId];
		return (
			candidates.find((id) =>
				data.categories.some((category) => category.id === id && category.type === submission.type)
			) ?? ''
		);
	}

	function draftFor(submission: Submission): Draft {
		const cached = drafts[submission.id];
		if (cached) return cached;
		const saved = form?.id === submission.id ? form.values : null;
		const text = (key: string, fallback = '') =>
			saved && Object.hasOwn(saved, key)
				? String(Array.isArray(saved[key]) ? (saved[key][0] ?? '') : (saved[key] ?? ''))
				: fallback;
		const list = (key: string, fallback: string[]) =>
			saved
				? Array.isArray(saved[key])
					? (saved[key] as string[])
					: saved[key]
						? [String(saved[key])]
						: []
				: fallback;
		return {
			url: text(
				submission.type === 'site'
					? 'site_url'
					: submission.type === 'app'
						? 'app_download_url'
						: 'book_download_url',
				submission.payload.url ?? ''
			),
			title: text('title', source(submission, 'title')),
			slug: text('slug', slugify(source(submission, 'title'), submission.payload.url)),
			summary: text('summary', source(submission, 'summary')),
			content: text('content', source(submission, 'content')),
			categoryId: text('categoryId', String(defaultCategoryId(submission))),
			sortOrder: text('sortOrder', '0'),
			isFeatured: saved ? Boolean(saved.isFeatured) : false,
			tagIds: list('tagIds', tagIds(submission).map(String)),
			newTagNames: list('newTagNames', []),
			message: text('message')
		};
	}
	let draft = $derived(selected ? draftFor(selected) : null);
	function captureDraft(target: HTMLFormElement) {
		if (!selected) return;
		const values = new FormData(target);
		drafts[selected.id] = {
			url: String(
				values.get('site_url') ??
					values.get('app_download_url') ??
					values.get('book_download_url') ??
					selected.payload.url ??
					''
			),
			title: String(values.get('title') ?? ''),
			slug: String(values.get('slug') ?? ''),
			summary: String(values.get('summary') ?? ''),
			content: String(values.get('content') ?? ''),
			categoryId: String(values.get('categoryId') ?? ''),
			sortOrder: String(values.get('sortOrder') ?? '0'),
			isFeatured: values.has('isFeatured'),
			tagIds: values.getAll('tagIds').map(String),
			newTagNames: values.getAll('newTagNames').map(String),
			message: String(values.get('message') ?? '')
		};
	}
	async function focusError() {
		await tick();
		const key = Object.keys(fields)[0],
			name = key?.startsWith('meta.') ? key.slice(5) : key;
		if (name) formElement?.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`)?.focus();
	}
	async function refreshQueue(completedId?: number) {
		syncing = true;
		const url = page.url.pathname + page.url.search;
		try {
			const response = await fetch(resolve('/api/admin/submissions') + page.url.search, {
				cache: 'no-store',
				signal: AbortSignal.timeout(10000)
			});
			const value = await response.json();
			if (
				!response.ok ||
				value.data?.source !== 'database' ||
				!Array.isArray(value.data.submissions) ||
				!Array.isArray(value.data.categories) ||
				!Array.isArray(value.data.tags) ||
				!Number.isSafeInteger(value.data.total) ||
				value.data.total < 0 ||
				!Number.isSafeInteger(value.data.filters?.page) ||
				value.data.filters.page < 1 ||
				!Number.isSafeInteger(value.data.pageCount) ||
				value.data.pageCount < 1 ||
				!validReviewKey(value.data.requestKey) ||
				value.data.reviewActorId !== initialData.reviewActorId
			)
				throw new Error(value.error ?? '审核队列读取失败。');
			if (url !== page.url.pathname + page.url.search) return;
			queueSnapshot = { url, data: { ...initialData, ...value.data } };
			queueReadError = '';
			await tick();
			if (completedId && !data.selected && data.filters.submission === completedId) {
				await goto(
					resolve(
						submissionQueueUrl(data.filters, {
							submission: data.submissions[0]?.id ?? null
						}) as '/admin/submissions'
					),
					{ keepFocus: true, noScroll: true }
				);
			}
		} catch {
			queueReadError = '队列刷新失败，保留了当前表单。请稍后刷新队列，再继续处理。';
		} finally {
			syncing = false;
		}
	}
	function validDraft(value: Draft) {
		return (
			['title', 'slug', 'summary', 'content', 'url', 'categoryId', 'sortOrder', 'message'].every(
				(key) => typeof value[key as keyof Draft] === 'string'
			) &&
			Array.isArray(value.tagIds) &&
			value.tagIds.every((id) => typeof id === 'string') &&
			Array.isArray(value.newTagNames) &&
			value.newTagNames.every((name) => typeof name === 'string') &&
			typeof value.isFeatured === 'boolean'
		);
	}
	async function readOutcome(id: number) {
		const response = await fetch(
			resolve('/api/admin/submissions/[id]/review', { id: String(id) }),
			{ signal: AbortSignal.timeout(10000), cache: 'no-store' }
		);
		if (!response.ok)
			throw new Error(
				response.status === 403 || response.status === 401
					? '无法核对状态，请重新登录后核对。'
					: '暂时无法核对审核状态，请稍后重试。'
			);
		const value = await response.json();
		const row = value.data;
		if (
			!row ||
			row.id !== id ||
			!Object.hasOwn(submissionStatuses, row.status) ||
			typeof row.processing !== 'boolean' ||
			typeof row.title !== 'string' ||
			typeof row.updatedAt !== 'string' ||
			(row.receipt !== null &&
				(!validReviewKey(row.receipt?.key) ||
					!['running', 'succeeded', 'failed'].includes(row.receipt?.state))) ||
			(row.publishedHref !== null &&
				(typeof row.publishedHref !== 'string' ||
					!/^\/(sites|posts|apps|books|bulletins)\/[^/?#]+$/.test(row.publishedHref)))
		)
			throw new Error('审核状态响应无效，请重新核对。');
		return value.data as Outcome;
	}
	async function finishAttempt(row: Outcome, success: boolean) {
		lastResult = row;
		if (success) delete drafts[row.id];
		const id = pending?.id;
		pending = null;
		storePending(null);
		cancelAvailable = false;
		clearTimeout(pollTimer);
		processing = false;
		message = success
			? `投稿当前状态：${label(row.status)}，已核对服务器结果。`
			: `${requestError || '本次请求未完成。'} 已核对状态，保留了编辑内容，可以修正后重新提交。`;
		await refreshQueue(success ? id : undefined);
		if (!success) await focusError();
	}
	async function checkOutcome(acknowledgedFailure = false) {
		if (checking) return;
		const attempt = pending;
		if (!attempt) {
			if (selected) {
				checking = true;
				try {
					const row = await readOutcome(selected.id);
					lastResult = row;
					message = `当前状态：${label(row.status)}${row.processing ? '，仍在处理中。' : '，已核对。'}`;
					await refreshQueue();
				} catch (cause) {
					message = cause instanceof Error ? cause.message : '状态核对失败。';
				} finally {
					checking = false;
				}
			}
			return;
		}
		checking = true;
		cancelAvailable = false;
		try {
			const row = await readOutcome(attempt.id);
			if (!alive || pending?.key !== attempt.key) return;
			if (row.processing) {
				message = '审核仍在处理中，暂不能重复提交。';
				if (++polls < 15) {
					clearTimeout(pollTimer);
					pollTimer = setTimeout(() => void checkOutcome(), 2000);
				}
				return;
			}
			if (['published', 'approved', 'rejected'].includes(row.status)) {
				await finishAttempt(row, true);
				return;
			}
			if (
				row.status === 'pending' &&
				((row.receipt?.key === attempt.key && row.receipt.state === 'failed') ||
					acknowledgedFailure ||
					(row.receipt &&
						row.receipt.key !== attempt.key &&
						row.receipt.key !== attempt.previousKey))
			) {
				await finishAttempt(row, false);
				return;
			}
			if (row.status === 'pending' && (row.receipt?.key ?? '') === attempt.previousKey) {
				cancelAvailable = true;
				message = '尚未确认本次请求是否开始。可以继续核对，或撤销尚未开始的审核后继续编辑。';
				return;
			}
			message = '审核结果尚未确认，请继续核对。';
		} catch (cause) {
			message = cause instanceof Error ? cause.message : '暂时无法核对审核状态。';
		} finally {
			checking = false;
		}
	}
	async function cancelUnstarted() {
		if (!pending || checking || !cancelAvailable) return;
		checking = true;
		try {
			await fetch(resolve('/api/admin/submissions/[id]/review', { id: String(pending.id) }), {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					decision: 'cancel-unstarted',
					requestKey: pending.key,
					previousKey: pending.previousKey
				}),
				signal: AbortSignal.timeout(10000)
			});
		} catch {
			/* Always verify whether the cancellation won before re-enabling edits. */
		} finally {
			checking = false;
			await checkOutcome();
		}
	}
	async function review(
		submission: Submission,
		decision: 'approve' | 'reject',
		target: HTMLFormElement
	) {
		if (locked || submission.processing || !submission.payloadAvailable) return;
		captureDraft(target);
		fieldSubmissionId = submission.id;
		const current = drafts[submission.id];
		localFields = {};
		if (decision === 'reject' && !current.message.trim()) {
			localFields = { message: '拒绝投稿时必须填写审核意见。' };
			await focusError();
			return;
		}
		if (
			!confirm(
				decision === 'approve'
					? `确认发布“${current.title}”？`
					: `确定拒绝“${submission.title}”吗？`
			)
		)
			return;
		const attempt: Pending = {
			id: submission.id,
			key: crypto.randomUUID(),
			previousKey: submission.receipt?.key ?? '',
			decision,
			draft: current
		};
		requestError = '';
		lastResult = null;
		pending = attempt;
		storePending(attempt);
		polls = 0;
		processing = true;
		message = '正在提交审核，请稍候…';
		let acknowledgedFailure = false;
		try {
			const body = {
				decision,
				requestKey: attempt.key,
				previousKey: attempt.previousKey,
				message: current.message,
				item: {
					type: submission.type,
					title: current.title,
					slug: current.slug,
					summary: current.summary,
					content: current.content,
					categoryId: current.categoryId ? Number(current.categoryId) : null,
					iconFileId: submission.payload.iconFileId ?? null,
					coverFileId: null,
					status: 'published',
					visibility: 'public',
					sortOrder: Number(current.sortOrder),
					isFeatured: current.isFeatured,
					tagIds: current.tagIds.map(Number),
					meta:
						submission.type === 'site'
							? { site_url: current.url }
							: submission.type === 'app'
								? { app_download_url: current.url }
								: submission.type === 'book'
									? { book_download_url: current.url }
									: {}
				},
				newTagNames: current.newTagNames
			};
			const response = await fetch(
				resolve('/api/admin/submissions/[id]/review', { id: String(submission.id) }),
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(15000)
				}
			);
			const result = await response.json();
			acknowledgedFailure = !response.ok;
			if (result.fields && typeof result.fields === 'object') localFields = result.fields;
			if (!response.ok) {
				requestError = result.error ?? '审核未完成。';
				message = requestError + ' 正在核对状态。';
			}
		} catch {
			message = '没有收到完整响应，正在核对审核结果。';
		} finally {
			processing = false;
			await checkOutcome(acknowledgedFailure);
		}
	}
	function blockBusy(event: MouseEvent) {
		if (processing || pending || syncing) event.preventDefault();
	}
</script>

{#snippet fieldError(name: string)}
	{#if fields[name]}<small class="review-field-error" id={`review-error-${name}`} role="alert"
			>{fields[name]}</small
		>{/if}
{/snippet}
<header class="admin-page-header">
	<div>
		<p class="eyebrow">投稿处理</p>
		<h1>投稿审核</h1>
		<span>对比用户提交、网页快照和 AI 建议，确认后发布。</span>
	</div>
</header>
<div class="review-controls">
	<div class="review-counts" aria-label="投稿统计">
		<span
			>待处理 <strong>{(data.summary.pending ?? 0) + (data.summary.reviewing ?? 0)}</strong></span
		><span
			>已通过 <strong>{(data.summary.published ?? 0) + (data.summary.approved ?? 0)}</strong></span
		><span>已拒绝 <strong>{data.summary.rejected ?? 0}</strong></span>
	</div>
	<a
		class="admin-secondary-button"
		href={resolve(submissionQueueUrl(data.filters) as '/admin/submissions')}
		aria-disabled={syncing}
		onclick={(event) => {
			event.preventDefault();
			if (!syncing) void refreshQueue();
		}}>{syncing ? '刷新中…' : '刷新队列'}</a
	>
</div>
{#if message || form?.message}<p class="admin-form-message" role="status">
		{message || form?.message}
	</p>{/if}
{#if !data.reviewActorId && data.source === 'database'}<p class="admin-notice">
		请使用管理员账号登录后审核投稿。
	</p>{/if}
{#if data.readError || queueReadError}<p class="admin-notice review-read-error" role="alert">
		{queueReadError || data.readError}{#if lastKnown}
			当前显示上次读取的内容，暂不能提交。{/if}
	</p>{/if}
{#if pending}<section class="review-recovery" aria-label="审核状态核对">
		<strong>正在核对投稿 #{pending.id}</strong>
		<p>结果确认前不会再次提交审核。刷新页面后可以继续核对。</p>
		<div class="admin-form-actions">
			<button
				type="button"
				class="admin-secondary-button"
				disabled={checking || processing}
				onclick={() => void checkOutcome()}>{checking ? '核对中…' : '核对状态'}</button
			>{#if cancelAvailable}<button
					type="button"
					class="admin-secondary-button"
					disabled={checking || processing}
					onclick={() => void cancelUnstarted()}>撤销未开始的审核</button
				>{/if}
		</div>
	</section>{/if}
{#if result}<p class="review-result" role="status">
		投稿 #{result.id}：{label(result.status)}{#if result.publishedHref}
			· <a href={resolve(result.publishedHref as '/')} onclick={blockBusy}>查看已发布内容</a>{/if}
	</p>{/if}
<div class="review-workbench">
	<aside class="review-queue">
		<div class="review-queue-head"><strong>审核队列</strong><span>{data.total} 条</span></div>
		<form
			class="review-filters"
			method="GET"
			action={resolve('/admin/submissions')}
			onsubmit={(event) => {
				if (processing || pending || syncing) event.preventDefault();
			}}
		>
			<label
				><span>搜索投稿</span><input
					name="q"
					value={data.filters.q}
					maxlength="160"
					placeholder="标题、投稿人或网址"
					disabled={processing || pending !== null || syncing}
				/></label
			>
			<label
				><span>审核状态</span><select
					name="status"
					value={data.filters.status}
					disabled={processing || pending !== null || syncing}
					><option value="pending">待处理</option><option value="reviewing">处理中</option><option
						value="published">已发布</option
					><option value="approved">历史已通过</option><option value="rejected">已拒绝</option
					><option value="all">全部</option></select
				></label
			>
			<button
				class="admin-secondary-button"
				type="submit"
				disabled={processing || pending !== null || syncing}>筛选</button
			>
		</form>
		<div class="review-list">
			{#each visible as submission (submission.id)}<a
					href={resolve(
						submissionQueueUrl(data.filters, { submission: submission.id }) as '/admin/submissions'
					)}
					class:active={selected?.id === submission.id}
					aria-current={selected?.id === submission.id ? 'true' : undefined}
					aria-disabled={processing || pending !== null || syncing}
					onclick={blockBusy}
					><span class="review-type"
						>{typeLabels[submission.type] ?? '投稿'} · {submission.processing
							? '处理中'
							: label(submission.status)}</span
					><strong>{submission.title}</strong><small
						>{submission.user.displayName} · {submission.createdAt.slice(0, 10)}</small
					>{#if submission.payload.aiSuggestion}<em>✦ AI</em>{/if}</a
				>{:else}<p class="admin-notice">没有匹配投稿。</p>{/each}
		</div>
		<nav class="review-pagination" aria-label="投稿分页">
			<p>第 {data.filters.page} / {data.pageCount} 页 · 每页 {data.pageSize} 条</p>
			<div>
				{#if data.filters.page > 1}<a
						href={resolve(
							submissionQueueUrl(data.filters, {
								page: data.filters.page - 1,
								submission: null
							}) as '/admin/submissions'
						)}
						onclick={blockBusy}>上一页</a
					>{/if}{#if data.filters.page < data.pageCount}<a
						href={resolve(
							submissionQueueUrl(data.filters, {
								page: data.filters.page + 1,
								submission: null
							}) as '/admin/submissions'
						)}
						onclick={blockBusy}>下一页</a
					>{/if}
			</div>
		</nav>
	</aside>

	<section class="review-detail">
		{#if data.selectedUnavailable}<p class="admin-notice" role="alert">
				所选投稿不存在或不符合当前筛选，请从队列重新选择。
			</p>{/if}
		{#if selected && data.selectedPage && data.selectedPage !== data.filters.page}<p
				class="admin-notice"
			>
				所选投稿在第 {data.selectedPage} 页。<a
					href={resolve(
						submissionQueueUrl(data.filters, {
							page: data.selectedPage,
							submission: selected.id
						}) as '/admin/submissions'
					)}
					onclick={blockBusy}>定位到所在页</a
				>
			</p>{/if}
		{#if selected}<div class="review-detail-head">
				<div>
					<p class="eyebrow">Submission #{selected.id}</p>
					<h2>{selected.title}</h2>
					<span>{selected.user.displayName} (@{selected.user.username}) · {selected.createdAt}</span
					>
				</div>
				<span class="status-badge">{selected.processing ? '处理中' : label(selected.status)}</span>
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
			{#if selected.status === 'pending' && !selected.processing && selected.payloadAvailable}{#key selected.id}
					<form
						class="admin-form review-form"
						method="POST"
						action={resolve(
							(submissionQueueUrl(data.filters, { submission: selected.id }) +
								'&/review') as '/admin/submissions'
						)}
						bind:this={formElement}
						oninput={(event) => captureDraft(event.currentTarget)}
						onchange={(event) => captureDraft(event.currentTarget)}
						onsubmit={(event) => {
							event.preventDefault();
							review(
								selected!,
								(event.submitter as HTMLButtonElement | null)?.value === 'reject'
									? 'reject'
									: 'approve',
								event.currentTarget
							);
						}}
					>
						<input type="hidden" name="id" value={selected.id} /><input
							type="hidden"
							name="type"
							value={selected.type}
						/><input type="hidden" name="requestKey" value={data.requestKey} /><input
							type="hidden"
							name="previousKey"
							value={selected.receipt?.key ?? ''}
						/><input type="hidden" name="iconFileId" value={selected.payload.iconFileId ?? ''} />
						<fieldset class="review-edit-fields" disabled={locked}>
							<h3>最终发布内容</h3>
							{#each Object.entries(fields).filter(([name]) => !['title', 'slug', 'categoryId', 'summary', 'content', 'sortOrder', 'message', 'tagIds', 'newTagNames', `meta.${urlField}`].includes(name)) as [name, error] (name)}<p
									class="review-field-error"
									role="alert"
								>
									{error}
								</p>{/each}
							<div class="admin-form-grid">
								{#if urlField}<label class="admin-field-wide"
										><span>目标地址</span><input
											name={urlField}
											type="url"
											maxlength="2000"
											required={selected?.type === 'site'}
											value={draft?.url}
											aria-invalid={Boolean(fields[`meta.${urlField}`]) || undefined}
											aria-describedby={fields[`meta.${urlField}`]
												? `review-error-meta.${urlField}`
												: undefined}
										/>{@render fieldError(`meta.${urlField}`)}</label
									>{/if}
								<label class="admin-field-wide"
									><span>标题</span><input
										name="title"
										required
										maxlength="160"
										value={draft?.title}
										aria-invalid={Boolean(fields.title) || undefined}
										aria-describedby={fields.title ? 'review-error-title' : undefined}
									/>{@render fieldError('title')}</label
								>
								<label
									><span>内容地址</span><input
										name="slug"
										required
										maxlength="100"
										pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
										value={draft?.slug}
										aria-invalid={Boolean(fields.slug) || undefined}
										aria-describedby={fields.slug ? 'review-error-slug' : undefined}
									/>{@render fieldError('slug')}</label
								>
								<label
									><span>分类</span><select
										name="categoryId"
										value={draft?.categoryId}
										aria-invalid={Boolean(fields.categoryId) || undefined}
										aria-describedby={fields.categoryId ? 'review-error-categoryId' : undefined}
										><option value="">未分类</option
										>{#if draft?.categoryId && !data.categories.some((category) => String(category.id) === draft?.categoryId && category.type === selected?.type)}<option
												value={draft.categoryId}>原分类已不可用，请重新选择</option
											>{/if}{#each data.categories.filter((category) => category.type === selected?.type) as category (category.id)}<option
												value={category.id}>{category.name}</option
											>{/each}</select
									><small
										>{selected.payload.userCategoryId
											? '投稿用户已选择分类，可手动调整。'
											: selected.payload.aiSuggestion?.categoryId
												? `AI 推荐：${selected.payload.aiSuggestion.categoryName}`
												: '未提供分类建议，请手动选择。'}</small
									>{@render fieldError('categoryId')}</label
								>
								<label class="admin-field-wide"
									><span>简介</span><textarea
										name="summary"
										maxlength="500"
										rows="3"
										aria-invalid={Boolean(fields.summary) || undefined}
										aria-describedby={fields.summary ? 'review-error-summary' : undefined}
										>{draft?.summary}</textarea
									>{@render fieldError('summary')}</label
								>
								<label class="admin-field-wide"
									><span>正文或补充说明</span><textarea
										name="content"
										maxlength="100000"
										rows="7"
										aria-invalid={Boolean(fields.content) || undefined}
										aria-describedby={fields.content ? 'review-error-content' : undefined}
										>{draft?.content}</textarea
									>{@render fieldError('content')}</label
								>
								<label
									><span>排序</span><input
										name="sortOrder"
										type="number"
										min="-100000"
										max="100000"
										value={draft?.sortOrder}
										aria-invalid={Boolean(fields.sortOrder) || undefined}
										aria-describedby={fields.sortOrder ? 'review-error-sortOrder' : undefined}
									/>{@render fieldError('sortOrder')}</label
								>
								<label class="admin-checkbox"
									><input name="isFeatured" type="checkbox" checked={draft?.isFeatured} /><span
										>设为推荐</span
									></label
								>
							</div>
							<fieldset class="admin-form-section">
								<legend>正式标签</legend>
								<p class="admin-form-hint">
									与建议同名的已有标签最多自动勾选 3 个，其余可手动追加。
								</p>
								{@render fieldError('tagIds')}{@render fieldError('newTagNames')}
								<div class="admin-check-grid">
									{#each data.tags.filter((tag) => tag.type === selected?.type) as tag (tag.id)}<label
											><input
												type="checkbox"
												name="tagIds"
												value={tag.id}
												checked={draft?.tagIds.includes(String(tag.id))}
											/><span>{tag.name}</span></label
										>{/each}{#each (draft?.tagIds ?? []).filter((id) => !data.tags.some((tag) => String(tag.id) === id && tag.type === selected?.type)) as id (id)}<label
											><input type="checkbox" name="tagIds" value={id} checked /><span
												>原标签已不可用（{id}），可取消勾选</span
											></label
										>{/each}
								</div>
								{#if missingTagNames(selected).length || draft?.newTagNames.length}<div
										class="new-tag-options"
									>
										<strong>建议中的新标签</strong>
										<p>勾选后将在审核发布时创建；不勾选不会进入标签库。</p>
										<div class="admin-check-grid">
											{#each [...new Set( [...missingTagNames(selected), ...(draft?.newTagNames ?? [])] )] as name (name)}<label
													class="new-tag-option"
													><input
														type="checkbox"
														name="newTagNames"
														value={name}
														checked={draft?.newTagNames.includes(name)}
													/><span>{name}<em>发布时创建</em></span></label
												>{/each}
										</div>
									</div>{/if}
							</fieldset>
							<label
								><span>审核意见</span><textarea
									name="message"
									rows="3"
									maxlength="2000"
									placeholder="通过时可选；拒绝时必填"
									aria-invalid={Boolean(fields.message) || undefined}
									aria-describedby={fields.message ? 'review-error-message' : undefined}
									>{draft?.message}</textarea
								>{@render fieldError('message')}</label
							>
							<div class="admin-form-actions">
								<button
									class="admin-primary-button"
									type="submit"
									name="decision"
									value="approve"
									disabled={locked}>{processing ? '处理中…' : '审核通过并发布'}</button
								><button
									class="admin-secondary-button"
									type="submit"
									name="decision"
									value="reject"
									formnovalidate
									disabled={locked}>拒绝投稿</button
								>
							</div>
						</fieldset>
					</form>{/key}{:else}<p class="admin-notice">
					{selected.processing
						? '审核结果尚未确认，暂不能重复提交。'
						: !selected.payloadAvailable
							? '投稿数据无法读取，暂不能审核。'
							: `审核意见：${selected.reviewMessage ?? '无'}`}
				</p>
				{#if selected.processing}<button
						type="button"
						class="admin-secondary-button review-check-button"
						onclick={() => void checkOutcome()}
						disabled={checking || pending !== null}>核对状态</button
					>{/if}{#if selected.publishedHref}<p class="admin-notice">
						<a href={resolve(selected.publishedHref as '/')} onclick={blockBusy}>查看已发布内容</a>
					</p>{/if}{/if}
		{:else}<div class="review-empty">
				<strong>没有待处理投稿</strong>
				<p>调整左侧筛选条件查看历史记录。</p>
			</div>{/if}
	</section>
</div>

<style>
	.review-controls,
	.review-counts {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
	}
	.review-controls {
		justify-content: space-between;
		margin-bottom: 16px;
	}
	.review-counts span {
		color: var(--admin-muted);
	}
	.review-counts strong {
		color: var(--admin-text);
	}
	.review-recovery,
	.review-result {
		border: 1px solid var(--admin-border);
		padding: 16px;
		border-radius: 12px;
		background: var(--admin-soft);
		margin-bottom: 16px;
		overflow-wrap: anywhere;
	}
	.review-recovery p {
		margin: 8px 0;
		color: var(--admin-muted);
	}
	.review-edit-fields {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
		display: grid;
		gap: 16px;
	}
	.review-field-error {
		color: var(--admin-danger) !important;
		display: block;
		overflow-wrap: anywhere;
	}
	.review-pagination {
		padding: 12px;
		display: grid;
		gap: 8px;
		border-top: 1px solid var(--admin-border);
	}
	.review-pagination p {
		font-size: 13px;
		color: var(--admin-muted);
		margin: 0;
	}
	.review-pagination div {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}
	.review-pagination a {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		color: var(--admin-accent);
	}
	.review-filters label {
		display: grid;
		gap: 5px;
		font-size: 13px;
	}
	.review-filters input,
	.review-filters select {
		min-height: 44px;
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
	}
	.review-list a {
		text-decoration: none;
		color: inherit;
		overflow-wrap: anywhere;
	}
	.review-list a:focus-visible {
		outline: 2px solid var(--admin-accent);
		outline-offset: -2px;
	}
	.review-list a[aria-disabled='true'] {
		cursor: wait;
	}
	.review-check-button {
		margin: 0 18px 16px;
	}

	.review-workbench {
		display: grid;
		grid-template-columns: 320px minmax(0, 1fr);
		gap: 16px;
		align-items: start;
	}
	.review-queue,
	.review-detail {
		border: 1px solid var(--admin-border);
		border-radius: 14px;
		background: var(--admin-surface);
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
		border-bottom: 1px solid var(--admin-border);
	}
	.review-queue-head span {
		border-radius: 999px;
		padding: 3px 8px;
		background: var(--admin-soft);
		font-size: 13px;
	}
	.review-filters {
		display: grid;
		gap: 8px;
		padding: 12px;
		border-bottom: 1px solid var(--admin-border);
	}
	.review-filters input,
	.review-filters select {
		min-height: 44px;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		padding: 0 10px;
		font: inherit;
	}
	.review-list {
		display: grid;
		max-height: calc(100vh - 250px);
		overflow: auto;
	}
	.review-list a {
		position: relative;
		display: grid;
		gap: 5px;
		border: 0;
		border-bottom: 1px solid var(--admin-border);
		padding: 13px 15px;
		background: var(--admin-surface);
		text-align: left;
		cursor: pointer;
	}
	.review-list a:hover,
	.review-list a.active {
		background: var(--admin-soft);
	}
	.review-list a.active {
		box-shadow: inset 3px 0 var(--admin-accent);
	}
	.review-list strong {
		font-size: 15px;
		padding-right: 40px;
	}
	.review-list small {
		color: var(--admin-muted);
		font-size: 13px;
	}
	.review-list em {
		position: absolute;
		top: 13px;
		right: 12px;
		color: var(--admin-accent);
		font-size: 13px;
		font-style: normal;
	}
	.review-type {
		color: var(--admin-muted);
		font-size: 13px;
		text-transform: uppercase;
	}
	.review-detail {
		overflow: hidden;
	}
	.review-detail-head h2 {
		overflow-wrap: anywhere;
		margin: 3px 0;
		font-size: 20px;
	}
	.review-detail-head > div {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.review-detail-head .status-badge {
		flex-shrink: 0;
		white-space: nowrap;
		padding: 4px 8px;
		color: var(--admin-text);
		background: var(--admin-soft);
	}
	.review-detail-head span {
		color: var(--admin-muted);
		font-size: 13px;
	}
	.review-url {
		display: block;
		margin: 14px 18px 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--admin-muted);
		font-size: 13px;
	}
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
	.new-tag-options {
		margin-top: 14px;
		border-top: 1px dashed var(--admin-border);
		padding-top: 12px;
	}
	.new-tag-options > p {
		margin: 4px 0 10px;
		color: var(--admin-muted);
		font-size: 13px;
	}
	.new-tag-option em {
		display: block;
		color: var(--admin-muted);
		font-size: 13px;
		font-style: normal;
	}
	.review-form {
		border: 0;
		border-top: 1px solid var(--admin-border);
		border-radius: 0;
		padding: 18px;
		box-shadow: none;
	}
	.review-edit-fields > h3 {
		margin-top: 0;
	}
	.review-empty {
		display: grid;
		min-height: 480px;
		place-items: center;
		align-content: center;
		color: var(--admin-muted);
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
