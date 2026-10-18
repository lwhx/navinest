<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		BOOKMARK_MAX_BYTES,
		BOOKMARK_IMPORT_LIMIT,
		bookmarkStates,
		type BookmarkPreview,
		type BookmarkReceipt,
		type BookmarkMapping
	} from '$lib/bookmark-import';
	let { userId, onlock }: { userId: number; onlock: (locked: boolean) => void } = $props();
	let ready = $state(false),
		file = $state<File | null>(null),
		html = $state(''),
		preview = $state<BookmarkPreview | null>(null);
	let busy = $state(false),
		dirty = $state(false),
		confirmed = $state(false),
		cancelConfirmed = $state(false),
		message = $state('');
	let recovery = $state<{ runId: string; digest: string } | null>(null),
		receipt = $state<BookmarkReceipt | null>(null);
	let query = $state(''),
		filter = $state('all'),
		page = $state(1),
		folderPage = $state(1);
	const storageKey = $derived(`navinest-bookmark-import:${userId}`);
	const selected = $derived(preview?.rows.filter((r) => r.selected) ?? []);
	const selectedFolders = $derived(new Set(selected.map((r) => r.folder)));
	const mappings = $derived(preview?.mappings.filter((m) => selectedFolders.has(m.folder)) ?? []);
	const folderPages = $derived(Math.max(1, Math.ceil(mappings.length / 10)));
	const rows = $derived(
		preview?.rows.filter(
			(r) =>
				(filter === 'all' || (filter === 'selected' ? r.selected : r.status === filter)) &&
				`${r.title} ${r.url} ${r.folder}`.toLowerCase().includes(query.trim().toLowerCase())
		) ?? []
	);
	const pages = $derived(Math.max(1, Math.ceil(rows.length / 20)));
	const locked = $derived(busy || !!recovery);
	$effect(() => onlock(locked));
	beforeNavigate(({ cancel }) => {
		if (busy) cancel();
	});
	onMount(() => {
		ready = true;
		try {
			const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
			if (stored && typeof stored.runId === 'string' && typeof stored.digest === 'string') {
				recovery = stored;
				void reconcile();
			}
		} catch {
			message = '无法读取浏览器中的上次导入信息，请先核对已有书签。';
		}
	});
	function changed() {
		dirty = true;
		confirmed = false;
		receipt = null;
	}
	function choose(event: Event) {
		file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
		html = '';
		preview = null;
		receipt = null;
		dirty = false;
		confirmed = false;
		message = '';
		query = '';
		filter = 'all';
		page = 1;
		folderPage = 1;
	}
	async function request(path: string, body?: unknown) {
		const controller = new AbortController(),
			timer = setTimeout(() => controller.abort(), 45000);
		try {
			const response = await fetch(path, {
				method: body === undefined ? 'GET' : 'POST',
				headers: body === undefined ? {} : { 'content-type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: controller.signal,
				cache: 'no-store'
			});
			return { response, value: await response.json() };
		} finally {
			clearTimeout(timer);
		}
	}
	function payload() {
		return {
			html,
			selected: preview?.rows.filter((r) => r.selected).map((r) => r.id),
			mappings: preview?.mappings.filter((mapping) => selectedFolders.has(mapping.folder))
		};
	}
	async function inspect(fresh = false) {
		if (locked || !file) return;
		busy = true;
		confirmed = false;
		receipt = null;
		try {
			if (file.size > BOOKMARK_MAX_BYTES) throw new Error('书签文件不能超过 2 MiB。');
			if (!html) html = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
			const { response, value } = await request(
				resolve('/api/user/navigation/import/preview'),
				fresh ? { html } : payload()
			);
			if (!response.ok) throw new Error(value.error ?? '预览未完成。');
			if (
				!value.preview ||
				!Array.isArray(value.preview.rows) ||
				!Array.isArray(value.preview.mappings) ||
				typeof value.preview.digest !== 'string'
			)
				throw new Error('未收到完整预览，请重试。');
			preview = value.preview;
			dirty = false;
			page = 1;
			folderPage = 1;
			message = `预览完成：文件共 ${preview!.total} 条，已选 ${preview!.selected} 条，将新建 ${preview!.newCategories.length} 个分类。尚未导入。`;
		} catch (error) {
			dirty = true;
			message =
				error instanceof TypeError
					? !html
						? '文件不是有效的 UTF-8 HTML，请重新导出后重试。'
						: '网络异常，预览未完成，文件已保留。'
					: error instanceof SyntaxError
						? '预览响应格式异常，请稍后重试。'
						: error instanceof Error
							? error.message
							: '预览失败，文件已保留，请重试。';
		} finally {
			busy = false;
		}
	}
	function clearRecovery() {
		recovery = null;
		cancelConfirmed = false;
		try {
			sessionStorage.removeItem(storageKey);
		} catch {
			/* An old completed marker is safe to reconcile again. */
		}
	}
	async function accept(value: unknown) {
		const r = value as BookmarkReceipt;
		if (
			!r ||
			!['completed', 'cancelled'].includes(r.status) ||
			!Number.isSafeInteger(r.imported) ||
			!Number.isSafeInteger(r.categories) ||
			r.digest !== recovery?.digest
		)
			throw new Error('批次响应不完整，请再次核对。');
		receipt = r;
		clearRecovery();
		confirmed = false;
		message =
			r.status === 'completed'
				? `导入已确认完成：新增 ${r.imported} 条书签、${r.categories} 个分类。`
				: '已取消尚未开始的批次；迟到的同批次请求也不能继续导入。';
		try {
			await invalidateAll();
		} catch {
			message += ' 导航列表刷新失败，可稍后刷新页面核对。';
		}
	}
	async function commit() {
		if (!preview || locked || dirty || !confirmed || !selected.length || receipt) return;
		const run = { runId: crypto.randomUUID(), digest: preview.digest };
		try {
			sessionStorage.setItem(storageKey, JSON.stringify(run));
		} catch {
			message = '浏览器无法保存批次信息，尚未导入；请允许会话存储后重试。';
			return;
		}
		recovery = run;
		busy = true;
		message = '正在导入，请等待结果…';
		try {
			const { response, value } = await request(resolve('/api/user/navigation/import'), {
				...payload(),
				...run,
				previewAt: preview.generatedAt,
				confirmed: true
			});
			if (!response.ok) {
				if (value.uncertain === false) {
					clearRecovery();
					dirty = true;
				}
				throw new Error(value.error ?? '结果尚未确认，请核对本批次。');
			}
			await accept(value.receipt);
		} catch (error) {
			message =
				error instanceof TypeError || error instanceof DOMException
					? '网络中断或超时，导入结果尚未确认，请核对本批次。'
					: error instanceof SyntaxError
						? '未收到完整导入响应，请核对本批次。'
						: error instanceof Error
							? error.message
							: '结果尚未确认，请核对本批次。';
		} finally {
			busy = false;
		}
	}
	async function reconcile() {
		if (!recovery || busy) return;
		busy = true;
		try {
			const { response, value } = await request(
				resolve('/api/user/navigation/import') +
					'?' +
					new URLSearchParams({ runId: recovery.runId })
			);
			if (!response.ok) throw new Error(value.error ?? '批次读取失败。');
			if (value.receipt) await accept(value.receipt);
			else message = '尚未查到完成记录，原请求仍可能到达。请稍后核对，或确认取消尚未开始的批次。';
		} catch (error) {
			message = error instanceof Error ? error.message : '暂时无法核对，请保留此批次。';
		} finally {
			busy = false;
		}
	}
	async function cancelRun() {
		if (!recovery || busy || !cancelConfirmed) return;
		busy = true;
		try {
			const { response, value } = await request(resolve('/api/user/navigation/import'), {
				...recovery,
				action: 'cancel',
				confirmed: true
			});
			if (!response.ok) throw new Error(value.error ?? '取消结果未确认。');
			await accept(value.receipt);
		} catch (error) {
			message = error instanceof Error ? error.message : '取消结果未确认，请再次核对。';
		} finally {
			busy = false;
		}
	}
	function target(mapping: BookmarkMapping, value: string) {
		mapping.target = value.startsWith('id:') ? 'existing' : (value as 'none' | 'new' | 'choose');
		mapping.categoryId = mapping.target === 'existing' ? Number(value.slice(3)) : null;
		if (mapping.target === 'new' && !mapping.name)
			mapping.name = (mapping.folder.split(' / ').at(-1) ?? '').slice(0, 80);
		changed();
	}
	function selectPage() {
		for (const row of rows.slice((page - 1) * 20, page * 20)) {
			if (selected.length >= BOOKMARK_IMPORT_LIMIT) break;
			if (['new', 'limited'].includes(row.status)) row.selected = true;
		}
		changed();
	}
</script>

<section class="bookmark-import" aria-labelledby="bookmark-import-title">
	<h3 id="bookmark-import-title">导入浏览器书签</h3>
	<p class="account-muted">
		选择 HTML 文件 → 预览与分类 → 确认导入。只添加到当前账号的自定义导航，已有内容保持原样。
	</p>
	<p class="account-muted">
		支持 Chrome、Edge、Firefox、Safari；UTF-8 文件最多 2 MiB / 5000 条，每批最多勾选 500
		条。预览不访问书签网址。
	</p>
	<noscript><p>书签预览和导入需要启用 JavaScript；仍可使用现有导航链接。</p></noscript>
	<form
		class="account-form"
		onsubmit={(event) => {
			event.preventDefault();
			inspect();
		}}
	>
		<label
			><span>书签 HTML 文件</span><input
				type="file"
				accept=".html,.htm,text/html"
				disabled={!ready || locked}
				onchange={choose}
			/></label
		>
		<button class="account-button" type="submit" disabled={!ready || locked || !file}
			>{busy ? '正在处理…' : preview ? '更新预览' : '生成预览'}</button
		>
	</form>
	{#if preview && dirty}<button
			class="account-button secondary"
			type="button"
			disabled={locked}
			onclick={() => inspect(true)}>重新生成预览（重置勾选与分类）</button
		>{/if}
	{#if message}<p class="import-message" role="status">{message}</p>{/if}
	{#if recovery}
		<div class="recovery" role="region" aria-label="导入结果核对">
			<p>本批次结果需要核对，暂不能开始另一批导入。刷新后会继续核对；文件无需再次上传。</p>
			<p class="batch-id">批次：{recovery.runId}</p>
			<button class="account-button" type="button" disabled={busy} onclick={reconcile}
				>核对导入结果</button
			>
			<label class="tick"
				><input
					type="checkbox"
					bind:checked={cancelConfirmed}
					disabled={busy}
				/>确认取消尚未开始的批次</label
			>
			<button
				class="account-button secondary"
				type="button"
				disabled={busy || !cancelConfirmed}
				onclick={cancelRun}>取消未开始的导入</button
			>
			<p class="account-muted">若导入已完成，会显示完成结果；取消不会删除已导入的书签。</p>
		</div>
	{/if}
	{#if preview}
		<div class="preview-head">
			<h4>核对书签</h4>
			<strong>已选 {selected.length} / {BOOKMARK_IMPORT_LIMIT} 条</strong>
		</div>
		<div class="import-summary" aria-label="预览统计">
			{#each Object.entries(bookmarkStates) as [state, label] (state)}<span
					>{label}
					<strong>{preview.rows.filter((row) => row.status === state).length}</strong></span
				>{/each}
		</div>
		{#if dirty}<p class="import-message">勾选或分类已变化，请更新预览后再确认导入。</p>{/if}
		<fieldset disabled={locked || !!receipt}>
			<div class="import-filters">
				<label
					><span>搜索预览</span><input
						type="search"
						bind:value={query}
						oninput={() => (page = 1)}
						placeholder="标题、网址或文件夹"
					/></label
				>
				<label
					><span>条目状态</span><select bind:value={filter} onchange={() => (page = 1)}
						><option value="all">全部条目</option><option value="selected">已勾选</option
						>{#each Object.entries(bookmarkStates) as [value, label] (value)}<option {value}
								>{label}</option
							>{/each}</select
					></label
				>
			</div>
			<div class="import-actions">
				<button class="account-button secondary" type="button" onclick={selectPage}
					>选中本页可导入</button
				><button
					class="account-button secondary"
					type="button"
					onclick={() => {
						for (const row of preview!.rows) row.selected = false;
						changed();
					}}>清空全部勾选</button
				>
			</div>
			<p class="account-muted">
				匹配 {rows.length} / {preview.total} 条，第 {Math.min(page, pages)} / {pages} 页。重复项跳过；不同查询参数和页面锚点分别保留。
			</p>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus this bounded scroll region.) -->
			<div class="import-rows" role="region" aria-label="书签预览条目，可滚动" tabindex="0">
				{#each rows.slice((Math.min(page, pages) - 1) * 20, Math.min(page, pages) * 20) as row (row.id)}
					<article class="import-row">
						<label class="tick"
							><input
								type="checkbox"
								bind:checked={row.selected}
								aria-label={`选择书签 ${row.id + 1} ${row.title}`}
								disabled={!['new', 'limited'].includes(row.status) ||
									(!row.selected && selected.length >= BOOKMARK_IMPORT_LIMIT)}
								onchange={changed}
							/><strong>{row.title}</strong></label
						>
						<span class="row-state">{row.selected ? '已选' : bookmarkStates[row.status]}</span>
						<p class="row-url">{row.url || '未填写网址'}</p>
						<p class="account-muted">
							原文件夹：{row.folder || '未分文件夹'}{row.error ? ' · ' + row.error : ''}
						</p>
					</article>
				{:else}<p>没有符合条件的书签。</p>{/each}
			</div>
			<div class="import-actions">
				<button
					class="account-button secondary"
					type="button"
					disabled={page <= 1}
					onclick={() => page--}>预览上一页</button
				><button
					class="account-button secondary"
					type="button"
					disabled={page >= pages}
					onclick={() => page++}>预览下一页</button
				>
			</div>
			<h4>文件夹与目标分类</h4>
			<p class="account-muted">
				只处理已勾选书签。原文件夹路径可保留为一个分类名称，也可改选已有分类或未分类。
			</p>
			{#each mappings.slice((Math.min(folderPage, folderPages) - 1) * 10, Math.min(folderPage, folderPages) * 10) as mapping (mapping.folder)}
				<div class="folder-mapping">
					<strong>{mapping.folder || '未分文件夹'}</strong><label
						><span>目标分类：{mapping.folder || '未分文件夹'}</span><select
							value={mapping.target === 'existing' ? 'id:' + mapping.categoryId : mapping.target}
							onchange={(event) => target(mapping, event.currentTarget.value)}
							><option value="none">未分类</option><option value="new">新建分类</option><option
								value="choose"
								disabled>请选择具体分类（存在同名项）</option
							>{#each preview.categories as category (category.id)}<option
									value={'id:' + category.id}>{category.name}（#{category.id}）</option
								>{/each}</select
						></label
					>{#if mapping.target === 'new'}<label
							><span>新分类名称：{mapping.folder || '未分文件夹'}</span><input
								bind:value={mapping.name}
								maxlength="80"
								oninput={changed}
							/></label
						>{/if}
				</div>
			{/each}
			<div class="import-actions">
				<span>分类对应第 {Math.min(folderPage, folderPages)} / {folderPages} 页</span><button
					class="account-button secondary"
					type="button"
					disabled={folderPage <= 1}
					onclick={() => folderPage--}>分类上一页</button
				><button
					class="account-button secondary"
					type="button"
					disabled={folderPage >= folderPages}
					onclick={() => folderPage++}>分类下一页</button
				>
			</div>
		</fieldset>
		{#if !receipt}
			<div class="import-confirm">
				<p>
					本次将新增 {preview.selected} 条书签、{preview.newCategories.length} 个分类。修改勾选或分类后需更新预览；预览有效期为
					15 分钟。
				</p>
				<label class="tick"
					><input
						type="checkbox"
						bind:checked={confirmed}
						disabled={locked || dirty || !selected.length}
					/>我已核对书签和目标分类，确认导入</label
				><button
					class="account-button"
					type="button"
					disabled={!ready || locked || dirty || !confirmed || !selected.length}
					onclick={commit}>确认导入所选书签</button
				>
			</div>
		{/if}
	{/if}
	{#if receipt}
		<div class="import-result">
			<strong>{receipt.status === 'completed' ? '本批次已完成' : '本批次已取消'}</strong>
			<p>
				新增书签 {receipt.imported} 条 · 新建分类 {receipt.categories} 个 · {new Date(
					receipt.completedAt
				).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）
			</p>
			<button
				class="account-button secondary"
				type="button"
				disabled={busy || !file}
				onclick={() => inspect(true)}>重新预览剩余书签</button
			>
			<p class="account-muted">刷新页面会保留已导入的书签；处理剩余条目时请重新预览文件。</p>
		</div>
	{/if}
</section>

<style>
	.bookmark-import {
		--line: #dce1e6;
		--panel: #fbfcfd;
		--ink: #34383e;
		--accent: #1f6f5c;
		border: 1px solid var(--line);
		border-radius: 16px;
		padding: 20px;
		margin: 20px 0;
		min-width: 0;
	}
	:global(:root[data-theme='dark']) .bookmark-import {
		--line: #414a46;
		--panel: #151918;
		--ink: #edf1ef;
		--accent: #72cfac;
	}
	.bookmark-import :global(.account-muted) {
		color: #636b74;
	}
	:global(:root[data-theme='dark']) .bookmark-import :global(.account-muted) {
		color: #b8c2bd;
	}
	.bookmark-import :global(button) {
		min-height: 44px;
	}
	.bookmark-import h3,
	.bookmark-import h4 {
		margin: 0 0 12px;
	}
	.bookmark-import h4 {
		margin-top: 24px;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 14px;
		min-width: 0;
	}
	input:not([type='checkbox']),
	select {
		width: 100%;
		min-height: 44px;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px;
		background: var(--panel);
		color: var(--ink);
		box-sizing: border-box;
		min-width: 0;
	}
	.tick {
		flex-direction: row;
		align-items: center;
		min-height: 44px;
		gap: 10px;
	}
	.tick input {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}
	.tick strong {
		overflow-wrap: anywhere;
	}
	.preview-head,
	.import-actions {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
		justify-content: space-between;
		margin: 12px 0;
	}
	.import-filters {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(140px, 220px);
		gap: 12px;
	}
	.import-rows {
		display: grid;
		gap: 10px;
		max-height: 560px;
		overflow: auto;
		padding: 2px;
	}
	.import-rows:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.import-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 10px 0;
	}
	.import-summary span {
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 6px 10px;
		font-size: 13px;
	}
	.import-row,
	.folder-mapping,
	.recovery,
	.import-confirm,
	.import-result {
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 14px;
		margin: 10px 0;
		min-width: 0;
	}
	.import-row p {
		margin: 6px 0;
		overflow-wrap: anywhere;
	}
	.row-state {
		display: inline-block;
		font-size: 13px;
		font-weight: 600;
	}
	.row-url,
	.batch-id {
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.folder-mapping {
		display: grid;
		gap: 12px;
	}
	.folder-mapping strong {
		overflow-wrap: anywhere;
	}
	.import-message {
		padding: 12px;
		border-left: 3px solid var(--accent);
		overflow-wrap: anywhere;
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.import-confirm button,
	.recovery button {
		margin: 10px 0;
	}
	.import-result strong {
		color: var(--ink);
	}
	@media (max-width: 600px) {
		.bookmark-import {
			padding: 14px;
		}
		.import-filters {
			grid-template-columns: minmax(0, 1fr);
		}
		.import-actions {
			justify-content: flex-start;
		}
		.import-row {
			padding: 12px;
		}
	}
</style>
