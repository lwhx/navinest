<script lang="ts">
	import { beforeNavigate, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { MEDIA_KINDS, mediaQuery, mediaSize, referenceUsage } from '$lib/media-library';
	import MediaUpload from '$lib/components/admin/MediaUpload.svelte';
	import MediaImage from '$lib/components/admin/MediaImage.svelte';
	import MediaPreview from '$lib/components/admin/MediaPreview.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let uploading = $state(false),
		deleting = $state<number | null>(null),
		message = $state(''),
		error = $state(false),
		preview = $state<number | null>(null);
	function fileAction(name: 'upload' | 'delete') {
		const query = mediaQuery(data.filters);
		return `?${query ? query + '&' : ''}/${name}`;
	}
	const busy = $derived(uploading || deleting !== null);
	beforeNavigate(({ cancel }) => {
		if (busy) cancel();
	});
	async function remove(id: number) {
		if (busy || !confirm(`确定删除图片 #${id}？此操作会删除原文件，无法撤销。`)) return;
		deleting = id;
		message = '';
		error = false;
		try {
			const response = await fetch(resolve('/api/admin/files/[id]', { id: String(id) }), {
				method: 'DELETE'
			});
			if (!response.ok) {
				const body = await response.json();
				throw new Error(body.error ?? '删除失败，请刷新核对。');
			}
			message = `图片 #${id} 已删除。`;
			try {
				await invalidateAll();
			} catch {
				error = true;
				message = '删除已完成，但列表刷新失败，请刷新核对。';
			}
		} catch (reason) {
			error = true;
			message = reason instanceof Error ? reason.message : '删除结果未确认，请刷新列表核对。';
		} finally {
			deleting = null;
		}
	}
</script>

<svelte:window
	onbeforeunload={(event) => {
		if (busy) {
			event.preventDefault();
			event.returnValue = '';
		}
	}}
/>
<header class="admin-page-header">
	<div>
		<p class="eyebrow">Media library</p>
		<h1>文件管理</h1>
		<p class="admin-page-description">查找图片、查看使用位置，统一管理内容和投稿资源。</p>
	</div>
	<span class="admin-count-badge">{data.total} 个匹配文件</span>
</header>
{#if data.source === 'fallback'}<p class="admin-notice">
		本地环境没有 D1，资源库保持只读。
	</p>{:else if !data.storageAvailable}<p class="admin-notice">
		图片存储暂不可用，当前无法上传、预览或删除。
	</p>{/if}
{#if message}<p class="library-message" class:error role={error ? 'alert' : 'status'}>
		{message}
	</p>{/if}
{#if form?.message}<p class="library-message error" role="alert">{form.message}</p>{/if}
<form
	class="library-filters"
	method="GET"
	action={resolve('/admin/files')}
	onsubmit={(event) => {
		if (busy) event.preventDefault();
	}}
>
	<label class="library-search"
		>搜索图片<input
			name="q"
			value={data.filters.q}
			maxlength="120"
			placeholder="图片编号、文件路径或引用名称"
		/></label
	>
	<label
		>图片格式<select name="kind" value={data.filters.kind}
			>{#each MEDIA_KINDS as [key, label] (key)}<option value={key}>{label}</option>{/each}</select
		></label
	>
	<label
		>引用状态<select name="usage" value={data.filters.usage}
			><option value="all">全部状态</option><option value="used">正在使用</option><option
				value="unused">未引用</option
			></select
		></label
	>
	<label>上传开始日期<input type="date" name="from" value={data.filters.from} /></label><label
		>上传结束日期<input type="date" name="to" value={data.filters.to} /></label
	>
	<label
		>排序<select name="order" value={data.filters.order}
			><option value="newest">最新上传</option><option value="oldest">最早上传</option><option
				value="size">文件从大到小</option
			></select
		></label
	>
	<div class="filter-actions">
		<button type="submit" class="admin-primary-button" disabled={busy}>筛选图片</button><a
			class="admin-secondary-button"
			href={resolve('/admin/files')}
			aria-disabled={busy || undefined}>重置</a
		>
	</div>
</form>
{#if data.source === 'database' && data.storageAvailable}<details class="library-upload">
		<summary>上传新图片</summary>
		<div>
			<MediaUpload
				disabled={busy}
				onbusy={(active) => (uploading = active)}
				onuploaded={async (file) => {
					message = `图片 #${file.id} 上传成功，可在内容编辑中选择。`;
					error = false;
					await invalidateAll();
				}}
			/>
		</div>
		<noscript
			><form
				class="admin-form"
				method="POST"
				action={fileAction('upload')}
				enctype="multipart/form-data"
			>
				<label>图片文件<input type="file" name="file" accept="image/*" required /></label><button
					type="submit"
					class="admin-primary-button">上传文件</button
				>
			</form></noscript
		>
	</details>{/if}
<div class="library-summary">
	<p>共 {data.total} 个匹配文件 · 第 {data.filters.page} / {data.pageCount} 页</p>
	<p>日期按 UTC 统计；被内容、用户资料或待处理投稿引用的图片受到保护。</p>
</div>
{#if data.files.length}<section class="library-grid" aria-label="文件列表" aria-busy={busy}>
		{#each data.files as file (file.id)}<article class="library-card" data-file-id={file.id}>
				<button
					type="button"
					class="library-preview"
					aria-label={`预览图片 #${file.id}`}
					disabled={!data.storageAvailable || busy}
					onclick={() => (preview = file.id)}
					><MediaImage id={file.id} alt={`文件 #${file.id} 预览`} /></button
				>
				<div class="library-body">
					<div class="library-heading">
						<h2>图片 #{file.id}</h2>
						<span class:used={file.references.length > 0}
							>{file.references.length ? `${file.references.length} 处引用` : '未引用'}</span
						>
					</div>
					<p>{file.mimeType ?? '未知格式'} · {mediaSize(file.size)}</p>
					<time datetime={file.createdAt}>{file.createdAt}</time>
					<details class="file-path">
						<summary>文件路径</summary><code>{file.objectKey}</code>
					</details>
					{#if file.references.length}<details class="file-references">
							<summary>查看使用位置（{file.references.length}）</summary>
							<ul>
								{#each file.references as reference (`${reference.kind}-${reference.id}-${reference.usage}`)}<li
									>
										{#if reference.kind === 'item'}<a
												href={resolve(`/admin/items?edit=${reference.id}`)}
												>{reference.title || `内容 #${reference.id}`}</a
											>{:else if reference.kind === 'submission'}<a
												href={resolve(`/admin/submissions?status=all&submission=${reference.id}`)}
												>{reference.title || `投稿 #${reference.id}`}</a
											>{:else}<span>{reference.title} · 用户 #{reference.id}</span>{/if}<small
											>{referenceUsage(reference.usage)}</small
										>
									</li>{/each}
							</ul>
						</details>
						<p class="protection-note">
							正在使用，解除引用后才可删除。
						</p>{:else if file.references.length === 0 && data.source === 'database' && data.storageAvailable}<form
							method="POST"
							action={fileAction('delete')}
							onsubmit={(event) => {
								event.preventDefault();
								remove(file.id);
							}}
						>
							<noscript
								><label><input type="checkbox" required />确认永久删除原文件</label></noscript
							><input type="hidden" name="id" value={file.id} /><button
								class="admin-danger-button"
								type="submit"
								disabled={busy}>{deleting === file.id ? '正在删除…' : '删除未引用图片'}</button
							>
						</form>{/if}
				</div>
			</article>{/each}
	</section>{:else}<div class="admin-empty-state">
		<strong>没有匹配的图片</strong>
		<p>试试其他搜索条件，或上传新的图片。</p>
	</div>{/if}
{#if data.pageCount > 1}<nav class="library-pagination" aria-label="图片分页">
		{#if data.filters.page > 1}<a
				class="admin-secondary-button"
				href={resolve(`/admin/files?${mediaQuery(data.filters, data.filters.page - 1)}`)}
				aria-disabled={busy || undefined}>上一页</a
			>{/if}<span>第 {data.filters.page} / {data.pageCount} 页</span
		>{#if data.filters.page < data.pageCount}<a
				class="admin-secondary-button"
				href={resolve(`/admin/files?${mediaQuery(data.filters, data.filters.page + 1)}`)}
				aria-disabled={busy || undefined}>下一页</a
			>{/if}
	</nav>{/if}
{#if preview !== null}<MediaPreview id={preview} onclose={() => (preview = null)} />{/if}

<style>
	.library-filters {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 12px;
		padding: 18px;
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		background: var(--admin-surface);
	}
	.library-filters label {
		display: grid;
		gap: 7px;
		flex: 1 1 145px;
		min-width: 0;
		color: var(--admin-text);
		font-size: 13px;
	}
	.library-filters .library-search {
		flex: 2 1 260px;
	}
	input,
	select {
		min-height: 44px;
		max-width: 100%;
		width: 100%;
		min-width: 0;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		background: var(--admin-surface);
		color: var(--admin-text);
		padding: 10px 12px;
		font: inherit;
	}
	.filter-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.library-upload {
		border: 1px solid var(--admin-border);
		background: var(--admin-surface);
		border-radius: 12px;
		padding: 16px;
		margin: 16px 0;
	}
	summary {
		min-height: 44px;
		align-content: center;
		color: var(--admin-text);
		font-size: 15px;
		cursor: pointer;
	}
	.library-upload > div {
		padding-top: 16px;
	}
	.library-summary {
		display: grid;
		gap: 6px;
		margin: 18px 0;
	}
	.library-summary p {
		margin: 0;
		color: var(--admin-muted);
		font-size: 13px;
		line-height: 1.7;
	}
	.library-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr));
		gap: 16px;
		align-items: start;
	}
	.library-card {
		min-width: 0;
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		overflow: hidden;
		background: var(--admin-surface);
	}
	.library-preview {
		display: block;
		width: 100%;
		border: 0;
		padding: 12px;
		background: var(--admin-surface);
		cursor: pointer;
	}
	.library-body {
		display: grid;
		gap: 10px;
		padding: 4px 16px 16px;
	}
	.library-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px;
	}
	h2 {
		margin: 0;
		color: var(--admin-text);
		font-size: 16px;
	}
	.library-heading > span {
		padding: 4px 8px;
		border-radius: 6px;
		background: var(--admin-soft);
		font-size: 13px;
		color: var(--admin-muted);
	}
	.library-heading > span.used {
		color: var(--admin-text);
	}
	.library-body p,
	.library-body time {
		margin: 0;
		font-size: 13px;
		color: var(--admin-muted);
		line-height: 1.7;
	}
	.library-body code {
		display: block;
		max-width: 100%;
		white-space: normal;
		overflow-wrap: anywhere;
		font-size: 12px;
		color: var(--admin-muted);
	}
	.file-path summary,
	.file-references summary {
		font-size: 13px;
	}
	ul {
		display: grid;
		gap: 10px;
		list-style: none;
		margin: 8px 0;
		padding: 0;
	}
	li {
		display: grid;
		gap: 4px;
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	li a {
		color: var(--admin-accent);
	}
	small {
		color: var(--admin-muted);
	}
	.library-pagination {
		display: flex;
		justify-content: center;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		margin: 24px 0;
		color: var(--admin-text);
	}
	.library-message {
		padding: 14px;
		border: 1px solid var(--admin-border);
		background: var(--admin-surface);
		color: var(--admin-text);
		border-radius: 10px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.library-message.error {
		color: var(--admin-danger);
	}
</style>
