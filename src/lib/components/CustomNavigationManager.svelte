<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SvelteMap, SvelteURL } from 'svelte/reactivity';
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { page as route } from '$app/state';
	import { resolve } from '$app/paths';
	import { filterLinks, linkHost } from '$lib/navigation-filter';
	import {
		navigationFilters,
		NAVIGATION_BATCH_LIMIT,
		type NavigationCategory,
		type NavigationData,
		type NavigationLink,
		type NavigationMutation,
		type NavigationPlan,
		type NavigationReceipt
	} from '$lib/custom-navigation-workspace';
	import BookmarkImportPanel from './BookmarkImportPanel.svelte';
	let { navigation, userId }: { navigation: NavigationData; userId: number } = $props();
	type Editor =
		| { resource: 'link'; id: number | null; data: Omit<NavigationLink, 'id'> }
		| { resource: 'category'; id: number | null; data: Omit<NavigationCategory, 'id'> };
	type Review = { plan: NavigationPlan; mutation: NavigationMutation; version: string };
	let categoriesOpen = $state(true),
		importOpen = $state(false);
	let ready = $state(false),
		busy = $state(false),
		importLocked = $state(false),
		message = $state('');
	let editor = $state<Editor | null>(null),
		original = $state(''),
		editorVersion = $state('');
	let editorElement = $state<HTMLElement>();
	let discardDialog = $state<HTMLDialogElement>();
	let discard = $state<(() => void) | null>(null),
		review = $state<Review | null>(null),
		confirmed = $state(false),
		reviewPage = $state(1);
	let selectedIds = $state<number[]>([]),
		bulkCategory = $state('');
	let recovery = $state<{ runId: string; digest: string } | null>(null),
		cancelConfirmed = $state(false);
	const filters = $derived(navigationFilters(route.url.searchParams));
	const locked = $derived(!ready || busy || importLocked || !!recovery);
	const dirty = $derived(!!editor && JSON.stringify(editor) !== original);
	const categoryMap = $derived(new Map(navigation.categories.map((c) => [c.id, c])));
	const counts = $derived.by(() => {
		const map = new SvelteMap<number | null, number>();
		for (const l of navigation.links) map.set(l.categoryId, (map.get(l.categoryId) ?? 0) + 1);
		return map;
	});
	const links = $derived(
		filterLinks(
			navigation.links.map((l) => ({
				...l,
				categoryName: categoryMap.get(l.categoryId ?? -1)?.name ?? null
			})),
			filters.query
		).filter(
			(l) =>
				(filters.category === 'all' ||
					(filters.category === 'none'
						? l.categoryId === null
						: l.categoryId === Number(filters.category))) &&
				(filters.status === 'all' || l.status === filters.status)
		)
	);
	const pages = $derived(Math.max(1, Math.ceil(links.length / filters.size)));
	const currentPage = $derived(Math.min(filters.page, pages));
	const visibleLinks = $derived(
		links.slice((currentPage - 1) * filters.size, currentPage * filters.size)
	);
	const matchingCategories = $derived(
		navigation.categories.filter((c) =>
			c.name.toLowerCase().includes(filters.categoryQuery.trim().toLowerCase())
		)
	);
	const categoryPages = $derived(Math.max(1, Math.ceil(matchingCategories.length / 10)));
	const categoryPage = $derived(Math.min(filters.categoryPage, categoryPages));
	const visibleCategories = $derived(
		matchingCategories.slice((categoryPage - 1) * 10, categoryPage * 10)
	);
	const selectedInFilter = $derived(links.filter((l) => selectedIds.includes(l.id)).length);
	const endpoint = resolve('/api/user/navigation/workspace');
	const storageKey = $derived(`navinest-navigation:${userId}`);
	$effect(() => {
		const owned = new Set(navigation.links.map((l) => l.id));
		if (selectedIds.some((id) => !owned.has(id)))
			selectedIds = selectedIds.filter((id) => owned.has(id));
	});
	$effect(() => {
		if (discard && discardDialog && !discardDialog.open) discardDialog.showModal();
		else if (!discard && discardDialog?.open) discardDialog.close();
	});
	beforeNavigate(({ cancel, to }) => {
		if (busy) {
			cancel();
			return;
		}
		if (dirty) {
			cancel();
			if (to?.url)
				ask(() => {
					editor = null;
					window.location.assign(to.url.href);
				});
		}
	});
	onMount(() => {
		ready = true;
		const media = window.matchMedia('(min-width: 601px)');
		const resize = () => (categoriesOpen = media.matches);
		resize();
		media.addEventListener('change', resize);
		try {
			const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
			if (value && typeof value.runId === 'string' && typeof value.digest === 'string') {
				recovery = value;
				void reconcile();
			}
		} catch {
			message = '无法读取上次操作批次，请先核对导航内容。';
		}
		return () => media.removeEventListener('change', resize);
	});
	function ask(action: () => void) {
		if (dirty) discard = action;
		else action();
	}
	function approveDiscard() {
		const action = discard;
		discard = null;
		editor = null;
		action?.();
	}
	function url(values: Record<string, string | number>) {
		const result = new SvelteURL(route.url);
		for (const [key, value] of Object.entries(values)) {
			if (String(value) === '' || String(value) === 'all') result.searchParams.delete(key);
			else result.searchParams.set(key, String(value));
		}
		result.hash = 'custom-navigation-title';
		return '/user' + result.search + result.hash;
	}
	function preserved(exclude: string[]) {
		return [...new Map(route.url.searchParams).entries()].filter(
			([name]) => !exclude.includes(name)
		);
	}
	async function search(event: SubmitEvent) {
		event.preventDefault();
		const data = new FormData(event.currentTarget as HTMLFormElement),
			values: Record<string, string | number> = { navPage: 1 };
		for (const [key, value] of data) if (typeof value === 'string') values[key] = value;
		if (data.has('navCategoryQuery')) values.navCategoryPage = 1;
		await goto(resolve(url(values) as '/'), { noScroll: true, keepFocus: true });
	}
	function categoryLabel(id: number | null) {
		return id === null ? '未分类' : `${categoryMap.get(id)?.name ?? '已失效分类'} #${id}`;
	}
	function toggle(id: number, checked: boolean) {
		if (checked) {
			if (selectedIds.length >= NAVIGATION_BATCH_LIMIT) {
				message = '每批最多勾选 500 条。';
				return;
			}
			selectedIds = [...selectedIds, id];
		} else selectedIds = selectedIds.filter((value) => value !== id);
	}
	function selectPage() {
		selectedIds = [...new Set([...selectedIds, ...visibleLinks.map((l) => l.id)])].slice(
			0,
			NAVIGATION_BATCH_LIMIT
		);
		message = selectedIds.length === 500 ? '已达每批 500 条上限。' : '';
	}
	async function focusEditor() {
		await tick();
		editorElement?.querySelector<HTMLInputElement>('input')?.focus();
		editorElement?.scrollIntoView({ block: 'nearest' });
	}
	function editLink(link?: NavigationLink) {
		ask(() => {
			review = null;
			editor = {
				resource: 'link',
				id: link?.id ?? null,
				data: link
					? {
							categoryId: link.categoryId,
							title: link.title,
							url: link.url,
							summary: link.summary,
							sortOrder: link.sortOrder,
							status: link.status
						}
					: {
							categoryId:
								filters.category !== 'all' &&
								filters.category !== 'none' &&
								categoryMap.has(Number(filters.category))
									? Number(filters.category)
									: null,
							title: '',
							url: '',
							summary: null,
							sortOrder: Math.max(0, ...navigation.links.map((l) => l.sortOrder)) + 10,
							status: 'active'
						}
			};
			original = JSON.stringify(editor);
			editorVersion = navigation.version ?? '';
			message = '';
			void focusEditor();
		});
	}
	function editCategory(category?: NavigationCategory) {
		ask(() => {
			review = null;
			editor = {
				resource: 'category',
				id: category?.id ?? null,
				data: category
					? { name: category.name, icon: category.icon, sortOrder: category.sortOrder }
					: {
							name: '',
							icon: null,
							sortOrder: Math.max(0, ...navigation.categories.map((c) => c.sortOrder)) + 10
						}
			};
			original = JSON.stringify(editor);
			editorVersion = navigation.version ?? '';
			message = '';
			void focusEditor();
		});
	}
	function hasNeighbor(kind: 'link' | 'category', id: number, direction: -1 | 1) {
		const list =
			kind === 'category'
				? navigation.categories
				: navigation.links.filter(
						(l) => l.categoryId === navigation.links.find((l) => l.id === id)?.categoryId
					);
		const index = list.findIndex((l) => l.id === id);
		return !!list[index + direction];
	}
	async function request(body?: unknown, runId?: string) {
		const controller = new AbortController(),
			timer = setTimeout(() => controller.abort(), 45000);
		try {
			const response = await fetch(
				body === undefined
					? endpoint + '?' + new URLSearchParams({ runId: runId ?? '' })
					: endpoint,
				{
					method: body === undefined ? 'GET' : 'POST',
					headers: body === undefined ? {} : { 'content-type': 'application/json' },
					body: body === undefined ? undefined : JSON.stringify(body),
					cache: 'no-store',
					signal: controller.signal
				}
			);
			return { response, value: await response.json() };
		} finally {
			clearTimeout(timer);
		}
	}
	async function prepare(mutation: NavigationMutation, auto = false) {
		if (locked || review) return;
		busy = true;
		message = '';
		confirmed = false;
		try {
			const version = editor ? editorVersion : (navigation.version ?? ''),
				{ response, value } = await request({ action: 'preview', mutation, version });
			if (!response.ok) throw new Error(value.error ?? '核对失败。');
			if (!value.plan || !Array.isArray(value.plan.items) || typeof value.plan.digest !== 'string')
				throw new Error('核对响应不完整，请重试。');
			const next = { mutation, version, plan: value.plan } as Review;
			review = next;
			reviewPage = 1;
			if (auto) await submit(next);
		} catch (error) {
			message = error instanceof Error ? error.message : '请求失败，填写内容和勾选已保留。';
		} finally {
			busy = false;
		}
	}
	async function saveEditor() {
		if (!editor) return;
		await prepare(
			editor.resource === 'link'
				? { kind: 'link-save', id: editor.id, data: { ...editor.data } }
				: { kind: 'category-save', id: editor.id, data: { ...editor.data } },
			true
		);
	}
	function clearRecovery() {
		recovery = null;
		cancelConfirmed = false;
		try {
			sessionStorage.removeItem(storageKey);
		} catch {
			/* A completed marker can be safely reconciled again. */
		}
	}
	async function accept(value: unknown) {
		const r = value as NavigationReceipt;
		if (
			!r ||
			!['completed', 'cancelled'].includes(r.status) ||
			r.digest !== recovery?.digest ||
			!Number.isSafeInteger(r.affected) ||
			r.affected < 0 ||
			r.affected > 500 ||
			!Number.isFinite(Date.parse(r.completedAt))
		)
			throw new Error('结果响应不完整，请核对此批次。');
		clearRecovery();
		message =
			r.status === 'completed'
				? `操作已完成，已确认处理 ${r.affected} 条记录。`
				: '已取消尚未执行的操作，迟到的同批次请求也不会修改导航。';
		if (r.status === 'completed') {
			editor = null;
			selectedIds = [];
		}
		review = null;
		confirmed = false;
		try {
			await invalidateAll();
		} catch {
			message += ' 列表刷新失败，请点击刷新列表核对。';
		}
	}
	async function submit(next: Review) {
		const run = { runId: crypto.randomUUID(), digest: next.plan.digest };
		try {
			sessionStorage.setItem(storageKey, JSON.stringify(run));
		} catch {
			message = '浏览器无法保存批次，尚未修改；请允许会话存储后重试。';
			review = null;
			return;
		}
		recovery = run;
		try {
			const { response, value } = await request({
				action: 'commit',
				mutation: next.mutation,
				version: next.version,
				previewAt: next.plan.generatedAt,
				...run,
				confirmed: true
			});
			if (!response.ok) {
				if (value.uncertain === false) {
					clearRecovery();
					review = null;
					confirmed = false;
				}
				throw new Error(value.error ?? '结果尚未确认，请核对此批次。');
			}
			await accept(value.receipt);
		} catch (error) {
			message =
				error instanceof SyntaxError
					? '未收到完整响应，请先核对此批次。'
					: error instanceof TypeError || error instanceof DOMException
						? '网络中断或超时，结果尚未确认，请先核对此批次。'
						: error instanceof Error
							? error.message
							: '结果尚未确认，请核对此批次。';
		}
	}
	async function commitReview() {
		if (!review || !confirmed || locked) return;
		busy = true;
		await submit(review);
		busy = false;
	}
	async function reconcile() {
		if (!recovery || busy) return;
		busy = true;
		try {
			const { response, value } = await request(undefined, recovery.runId);
			if (!response.ok) throw new Error(value.error ?? '暂时无法核对。');
			if (value.receipt) await accept(value.receipt);
			else message = '尚未查到完成记录，原请求仍可能到达。请稍后核对，或取消尚未执行的批次。';
		} catch {
			message = '暂时无法核对，请保留此批次，不要重新提交。';
		} finally {
			busy = false;
		}
	}
	async function cancelRun() {
		if (!recovery || busy || !cancelConfirmed) return;
		busy = true;
		try {
			const { response, value } = await request({ action: 'cancel', ...recovery, confirmed: true });
			if (!response.ok) throw new Error(value.error ?? '取消结果未确认。');
			await accept(value.receipt);
		} catch (error) {
			message = error instanceof Error ? error.message : '取消结果未确认，请重试核对。';
		} finally {
			busy = false;
		}
	}
	async function refresh() {
		if (locked) return;
		busy = true;
		try {
			await invalidateAll();
			message = editor
				? '列表已刷新，当前草稿已保留；如数据已变化，请载入最新记录后重新编辑。'
				: '列表已刷新，仍有效的勾选已保留。';
		} catch {
			message = '刷新失败，现有列表和草稿已保留。';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:window
	onbeforeunload={(event) => {
		if (dirty || busy) {
			event.preventDefault();
			event.returnValue = '';
		}
	}}
/>
<section class="account-card navigation-workspace" aria-labelledby="custom-navigation-title">
	<header class="workspace-header">
		<div>
			<p class="eyebrow">MY LINKS</p>
			<h2 id="custom-navigation-title">自定义导航</h2>
			<p class="muted">
				{navigation.links.length} 条链接 · {navigation.categories.length} 个分类 · {navigation.links.filter(
					(l) => l.status === 'inactive'
				).length} 条已停用
			</p>
		</div>
		<div class="actions">
			<button class="primary" disabled={locked || !!review} onclick={() => editLink()}
				>新增链接</button
			><button disabled={locked || !!review} onclick={() => editCategory()}>添加分类</button><button
				disabled={locked}
				onclick={refresh}>刷新列表</button
			>
		</div>
	</header>
	<noscript
		><p class="notice">浏览和筛选可直接使用；编辑、勾选整理和导入需要启用 JavaScript。</p></noscript
	>
	{#if message}<p class="notice workspace-message" role="status" aria-live="polite">
			{message}
		</p>{/if}
	{#if importLocked}<p class="notice">书签导入正在进行或等待结果核对，导航编辑暂时锁定。</p>{/if}
	{#if recovery}<section class="recovery panel" aria-label="导航操作结果核对">
			<h3>先核对上次操作结果</h3>
			<p>批次 {recovery.runId}</p>
			<p>未查到记录不表示失败。当前已阻止再次修改，以免原请求迟到后重复操作。</p>
			<button disabled={busy} onclick={reconcile}>核对此批次</button><label class="check"
				><input
					type="checkbox"
					bind:checked={cancelConfirmed}
					disabled={busy}
				/>确认取消尚未执行的操作</label
			><button disabled={busy || !cancelConfirmed} onclick={cancelRun}>取消未执行的操作</button>
		</section>{/if}
	<div class="view-switch" aria-label="管理视图">
		<a
			class:current={filters.view === 'links'}
			href={resolve(url({ navView: 'links', navPage: 1 }) as '/')}
			aria-current={filters.view === 'links' ? 'page' : undefined}
			data-sveltekit-noscroll>我的链接</a
		><a
			class:current={filters.view === 'categories'}
			href={resolve(url({ navView: 'categories' }) as '/')}
			aria-current={filters.view === 'categories' ? 'page' : undefined}
			data-sveltekit-noscroll>管理分类</a
		>
	</div>
	{#if editor}
		<section
			class="panel editor"
			aria-labelledby="navigation-editor-title"
			bind:this={editorElement}
		>
			<div class="workspace-header">
				<div>
					<h3 id="navigation-editor-title">
						{editor.id ? '编辑' : '新增'}{editor.resource === 'link' ? '链接' : '分类'}
					</h3>
					<p class="muted">
						{dirty ? '有未保存的修改' : '填写后点击保存'}{editor.id ? ` · 编号 #${editor.id}` : ''}
					</p>
				</div>
				<button disabled={locked} onclick={() => ask(() => (editor = null))}>关闭编辑</button>
			</div>
			{#if editorVersion !== navigation.version}<div class="notice">
					<p>列表已变化，草稿仍保留。保存前请载入最新记录重新核对；此操作会放弃当前草稿。</p>
					<button
						disabled={locked}
						onclick={() => {
							const current = editor;
							if (!current) return;
							if (current.resource === 'link') {
								const found = navigation.links.find((l) => l.id === current.id);
								if (current.id && !found) {
									message = '此链接已被删除，请先关闭编辑。';
									return;
								}
								editLink(found);
							} else {
								const found = navigation.categories.find((c) => c.id === current.id);
								if (current.id && !found) {
									message = '此分类已被删除，请先关闭编辑。';
									return;
								}
								editCategory(found);
							}
						}}>载入最新记录</button
					>
				</div>{/if}
			<form
				onsubmit={(event) => {
					event.preventDefault();
					saveEditor();
				}}
			>
				<fieldset disabled={locked || !!review} class="editor-grid">
					{#if editor.resource === 'link'}
						<label
							><span>链接标题</span><input
								bind:value={editor.data.title}
								required
								maxlength="120"
							/></label
						><label
							><span>网址</span><input
								bind:value={editor.data.url}
								required
								type="url"
								maxlength="2048"
							/></label
						>
						<label
							><span>链接分类</span><select bind:value={editor.data.categoryId}
								><option value={null}>未分类</option
								>{#each navigation.categories as category (category.id)}<option value={category.id}
										>{category.name} #{category.id}</option
									>{/each}</select
							></label
						>
						<label
							><span>链接状态</span><select bind:value={editor.data.status}
								><option value="active">启用</option><option value="inactive">停用</option></select
							></label
						>
						<label class="wide"
							><span>链接摘要</span><textarea
								bind:value={editor.data.summary}
								maxlength="300"
								rows="3"></textarea></label
						>
					{:else}<label class="wide"
							><span>分类名称</span><input
								bind:value={editor.data.name}
								required
								maxlength="80"
							/></label
						>{/if}
					<label
						><span>排序值</span><input
							type="number"
							bind:value={editor.data.sortOrder}
							required
							step="1"
							min="-1000000000000"
							max="1000000000000"
						/></label
					>
					<div class="actions wide">
						<button class="primary" type="submit"
							>{busy ? '保存中…' : '保存' + (editor.resource === 'link' ? '链接' : '分类')}</button
						><button type="button" onclick={() => ask(() => (editor = null))}>取消编辑</button>
					</div>
				</fieldset>
			</form>
		</section>
	{/if}
	{#if review && !recovery}
		<section class="panel operation-review" aria-labelledby="navigation-review-title">
			<h3 id="navigation-review-title">核对操作：{review.plan.title}</h3>
			<p>本次将处理 <strong>{review.plan.affected}</strong> 条记录。{review.plan.detail}</p>
			<ol start={(reviewPage - 1) * 10 + 1}>
				{#each review.plan.items.slice((reviewPage - 1) * 10, reviewPage * 10) as item (item.id)}<li
					>
						<strong>{item.title}</strong>{#if item.id}
							<span>#{item.id}</span>{/if}{#if item.url}<small>{item.url}</small>{/if}
					</li>{/each}
			</ol>
			<div class="pager">
				<button disabled={locked || reviewPage === 1} onclick={() => reviewPage--}
					>核对上一页</button
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
				<button class="primary" disabled={locked || !confirmed} onclick={commitReview}
					>确认执行{review.plan.title}</button
				><button
					disabled={locked}
					onclick={() => {
						review = null;
						confirmed = false;
					}}>返回整理</button
				>
			</div>
		</section>
	{/if}
	<div class="workspace-body">
		<details class="category-sidebar" aria-label="导航分类" bind:open={categoriesOpen}>
			<summary
				>选择分类 <small
					>{filters.category === 'all'
						? '全部链接'
						: filters.category === 'none'
							? '未分类'
							: categoryLabel(Number(filters.category))}</small
				></summary
			>
			<a
				class:current={filters.category === 'all'}
				href={resolve(url({ navCategory: 'all', navPage: 1, navView: 'links' }) as '/')}
				data-sveltekit-noscroll><span>全部链接</span><span>{navigation.links.length}</span></a
			><a
				class:current={filters.category === 'none'}
				href={resolve(url({ navCategory: 'none', navPage: 1, navView: 'links' }) as '/')}
				data-sveltekit-noscroll><span>未分类</span><span>{counts.get(null) ?? 0}</span></a
			>
			<form method="GET" action={resolve('/user')} onsubmit={search}>
				<input
					type="hidden"
					name="navCategoryPage"
					value="1"
				/>{#each preserved(['navCategoryQuery', 'navCategoryPage']) as [name, value] (name)}<input
						type="hidden"
						{name}
						{value}
					/>{/each}<label
					><span>查找分类</span><input
						type="search"
						name="navCategoryQuery"
						value={filters.categoryQuery}
						maxlength="80"
						placeholder="分类名称"
					/></label
				><button type="submit">查找分类</button>
			</form>
			{#each visibleCategories as category (category.id)}<a
					class:current={filters.category === String(category.id)}
					href={resolve(url({ navCategory: category.id, navPage: 1, navView: 'links' }) as '/')}
					data-sveltekit-noscroll
					><span>{category.name}<small>#{category.id}</small></span><span
						>{counts.get(category.id) ?? 0}</span
					></a
				>{/each}
			{#if !matchingCategories.length}<p class="muted">没有匹配的分类。</p>{/if}
			<nav class="pager" aria-label="分类分页">
				{#if categoryPage > 1}<a
						href={resolve(url({ navCategoryPage: categoryPage - 1 }) as '/')}
						data-sveltekit-noscroll>前页</a
					>{:else}<span>前页</span>{/if}<span>{categoryPage}/{categoryPages}</span
				>{#if categoryPage < categoryPages}<a
						href={resolve(url({ navCategoryPage: categoryPage + 1 }) as '/')}
						data-sveltekit-noscroll>后页</a
					>{:else}<span>后页</span>{/if}
			</nav>
		</details>
		<div class="workspace-main">
			{#if filters.view === 'links'}
				<form class="filters" method="GET" action={resolve('/user')} onsubmit={search}>
					{#each preserved( ['navQuery', 'navStatus', 'navSize', 'navPage'] ) as [name, value] (name)}<input
							type="hidden"
							{name}
							{value}
						/>{/each}<input type="hidden" name="navPage" value="1" />
					<label class="search"
						><span>搜索链接</span><input
							name="navQuery"
							type="search"
							value={filters.query}
							placeholder="标题、网址、摘要或分类"
							maxlength="200"
						/></label
					><label
						><span>筛选状态</span><select name="navStatus" value={filters.status}
							><option value="all">全部状态</option><option value="active">启用</option><option
								value="inactive">停用</option
							></select
						></label
					><label
						><span>每页条数</span><select name="navSize" value={String(filters.size)}
							><option value="20">20 条</option><option value="50">50 条</option></select
						></label
					><button type="submit">筛选链接</button>
				</form>
				<div class="result-heading">
					<div>
						<h3>
							{filters.category === 'all'
								? '全部链接'
								: filters.category === 'none'
									? '未分类'
									: categoryLabel(Number(filters.category))}
						</h3>
						<p class="muted">
							匹配 {links.length} / {navigation.links.length} 条 · 第 {currentPage} / {pages} 页
						</p>
					</div>
					<div class="actions">
						<button disabled={locked || !!review || !visibleLinks.length} onclick={selectPage}
							>勾选本页</button
						><button
							disabled={locked || !!review || !selectedIds.length}
							onclick={() => (selectedIds = [])}>清空勾选</button
						>
					</div>
				</div>
				{#if selectedIds.length}<section class="panel bulk" aria-label="批量整理">
						<h3>已勾选 {selectedIds.length} 条</h3>
						<p class="muted">
							当前筛选内 {selectedInFilter} 条，其他筛选内 {selectedIds.length - selectedInFilter} 条。跨页勾选会保留，每批最多
							500 条。
						</p>
						<fieldset disabled={locked || !!review || !!editor}>
							<label
								><span>批量目标分类</span><select bind:value={bulkCategory}
									><option value="">未分类</option
									>{#each navigation.categories as category (category.id)}<option
											value={String(category.id)}>{category.name} #{category.id}</option
										>{/each}</select
								></label
							>
							<div class="actions">
								<button
									onclick={() =>
										prepare({
											kind: 'link-bulk',
											ids: [...selectedIds],
											change: 'move',
											categoryId: bulkCategory ? Number(bulkCategory) : null
										})}>移动到分类</button
								><button
									onclick={() =>
										prepare({ kind: 'link-bulk', ids: [...selectedIds], change: 'active' })}
									>批量启用</button
								><button
									onclick={() =>
										prepare({ kind: 'link-bulk', ids: [...selectedIds], change: 'inactive' })}
									>批量停用</button
								><button
									class="danger"
									onclick={() => prepare({ kind: 'link-delete', ids: [...selectedIds] })}
									>删除所选</button
								>
							</div>
						</fieldset>
					</section>{/if}
				<div class="navigation-list">
					{#each visibleLinks as link (link.id)}<article class="navigation-row">
							<label class="row-select"
								><input
									type="checkbox"
									aria-label={`选择链接 ${link.id} ${link.title}`}
									checked={selectedIds.includes(link.id)}
									disabled={locked ||
										!!review ||
										(!selectedIds.includes(link.id) && selectedIds.length >= 500)}
									onchange={(event) => toggle(link.id, event.currentTarget.checked)}
								/></label
							>
							<div class="link-info">
								<h4>
									<a
										href={resolve(`/go?url=${encodeURIComponent(link.url)}` as '/')}
										target="_blank"
										rel="external noopener noreferrer">{link.title}</a
									>
								</h4>
								<p class="link-url" title={link.url}>
									{linkHost(link.url)}<small>{link.url}</small>
								</p>
								{#if link.summary}<p class="summary">{link.summary}</p>{/if}
								<div class="badges">
									<span>{categoryLabel(link.categoryId)}</span><span
										class:inactive={link.status === 'inactive'}
										>{link.status === 'active' ? '启用' : '停用'}</span
									><span>排序 {link.sortOrder}</span>
								</div>
							</div>
							<div class="row-actions">
								<button
									disabled={locked || !!review}
									onclick={() => editLink(link)}
									aria-label={`编辑链接 ${link.id} ${link.title}`}>编辑</button
								><button
									disabled={locked || !!review || !!editor || !hasNeighbor('link', link.id, -1)}
									aria-label="上移链接"
									title="在同分类内上移"
									onclick={() =>
										prepare({ kind: 'move', resource: 'link', id: link.id, direction: -1 }, true)}
									>↑</button
								><button
									disabled={locked || !!review || !!editor || !hasNeighbor('link', link.id, 1)}
									aria-label="下移链接"
									title="在同分类内下移"
									onclick={() =>
										prepare({ kind: 'move', resource: 'link', id: link.id, direction: 1 }, true)}
									>↓</button
								><button
									class="danger"
									disabled={locked || !!review || !!editor}
									aria-label={`删除链接 ${link.id} ${link.title}`}
									onclick={() => prepare({ kind: 'link-delete', ids: [link.id] })}>删除</button
								>
							</div>
						</article>{/each}
				</div>
				{#if !links.length}<div class="empty">
						<h3>{navigation.links.length ? '没有匹配的链接' : '还没有自定义链接'}</h3>
						<p class="muted">
							{navigation.links.length
								? '调整搜索或分类，勾选的链接仍保留。'
								: '添加常用网址，或在下方导入浏览器书签。'}
						</p>
						<a
							href={resolve(
								url({ navCategory: 'all', navQuery: '', navStatus: 'all', navPage: 1 }) as '/'
							)}
							data-sveltekit-noscroll>查看全部链接</a
						>
					</div>{/if}
				<nav class="pager link-pager" aria-label="链接分页">
					{#if currentPage > 1}<a
							href={resolve(url({ navPage: currentPage - 1 }) as '/')}
							data-sveltekit-noscroll>链接上一页</a
						>{:else}<span>链接上一页</span>{/if}<span>{currentPage} / {pages}</span
					>{#if currentPage < pages}<a
							href={resolve(url({ navPage: currentPage + 1 }) as '/')}
							data-sveltekit-noscroll>链接下一页</a
						>{:else}<span>链接下一页</span>{/if}
				</nav>
			{:else}
				<h3>管理分类</h3>
				<p class="muted">
					共 {matchingCategories.length} 个匹配分类，每页显示 10 个。删除分类会保留链接并移至未分类。
				</p>
				<div class="navigation-list">
					{#each visibleCategories as category (category.id)}<article
							class="navigation-row category-row"
						>
							<div class="link-info">
								<h4>{category.name}</h4>
								<p class="muted">
									#{category.id} · {counts.get(category.id) ?? 0} 条链接 · 排序 {category.sortOrder}
								</p>
							</div>
							<div class="row-actions">
								<button
									disabled={locked || !!review}
									onclick={() => editCategory(category)}
									aria-label={`编辑分类 ${category.id} ${category.name}`}>编辑</button
								><button
									disabled={locked ||
										!!review ||
										!!editor ||
										!hasNeighbor('category', category.id, -1)}
									aria-label="上移分类"
									onclick={() =>
										prepare(
											{ kind: 'move', resource: 'category', id: category.id, direction: -1 },
											true
										)}>↑</button
								><button
									disabled={locked ||
										!!review ||
										!!editor ||
										!hasNeighbor('category', category.id, 1)}
									aria-label="下移分类"
									onclick={() =>
										prepare(
											{ kind: 'move', resource: 'category', id: category.id, direction: 1 },
											true
										)}>↓</button
								><button
									class="danger"
									disabled={locked || !!review || !!editor}
									aria-label={`删除分类 ${category.id} ${category.name}`}
									onclick={() => prepare({ kind: 'category-delete', id: category.id })}>删除</button
								>
							</div>
						</article>{/each}
				</div>
				{#if !matchingCategories.length}<p class="empty muted">没有匹配的分类。</p>{/if}
				<nav class="pager" aria-label="分类管理分页">
					{#if categoryPage > 1}<a
							href={resolve(url({ navCategoryPage: categoryPage - 1 }) as '/')}
							data-sveltekit-noscroll>分类上一页</a
						>{:else}<span>分类上一页</span>{/if}
					<span>{categoryPage} / {categoryPages}</span>
					{#if categoryPage < categoryPages}<a
							href={resolve(url({ navCategoryPage: categoryPage + 1 }) as '/')}
							data-sveltekit-noscroll>分类下一页</a
						>{:else}<span>分类下一页</span>{/if}
				</nav>
			{/if}
		</div>
	</div>
	<details class="import-drawer" bind:open={importOpen}>
		<summary>导入浏览器书签</summary>{#if editor || review}<p class="muted">
				请先完成或关闭编辑与操作核对，再导入书签。
			</p>{/if}<BookmarkImportPanel
			{userId}
			disabled={busy || !!recovery || !!editor || !!review}
			onlock={(value) => {
				importLocked = value;
				if (value) importOpen = true;
			}}
		/>
	</details>
</section>
<dialog
	class="discard-dialog"
	bind:this={discardDialog}
	oncancel={(event) => {
		event.preventDefault();
		discard = null;
	}}
	aria-labelledby="discard-title"
>
	<h2 id="discard-title">放弃未保存的修改？</h2>
	<p>当前编辑内容尚未保存，继续会丢弃这些修改。</p>
	<div class="actions">
		<button onclick={() => (discard = null)}>继续编辑</button><button
			class="danger"
			onclick={approveDiscard}>放弃修改并继续</button
		>
	</div>
</dialog>

<style>
	.navigation-workspace {
		--nw-bg: #fff;
		--nw-soft: #f6f7fa;
		--nw-border: #dce0e7;
		--nw-text: #252c36;
		--nw-muted: #626c7a;
		color: var(--nw-text);
	}
	:global([data-theme='dark']) .navigation-workspace {
		--nw-bg: #20252d;
		--nw-soft: #282f39;
		--nw-border: #444d5b;
		--nw-text: #edf0f5;
		--nw-muted: #b8c0cd;
	}
	.navigation-workspace h3,
	.navigation-workspace h4 {
		color: var(--nw-text);
		margin: 0 0 6px;
	}
	.navigation-workspace p {
		margin: 0 0 10px;
		line-height: 1.6;
	}
	.muted {
		color: var(--nw-muted);
		font-size: 13px;
	}
	.eyebrow {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.15em;
		color: #b72a36;
	}
	.workspace-header,
	.result-heading {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: flex-start;
		margin-bottom: 18px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	button,
	.pager a,
	.view-switch a {
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
		text-decoration: none;
		text-align: center;
		line-height: 1.4;
	}
	button:hover:not(:disabled),
	a.current {
		border-color: #c22c3c;
		background: var(--nw-soft);
	}
	button.primary {
		background: #c42b3b;
		border-color: #c42b3b;
		color: white;
	}
	button.danger {
		color: #b62333;
		border-color: #dba8af;
	}
	button:disabled {
		opacity: 0.48;
		cursor: not-allowed;
	}
	:global([data-theme='dark']) button.danger {
		color: #ffabb5;
	}
	.notice,
	.panel {
		padding: 18px;
		background: var(--nw-soft);
		border: 1px solid var(--nw-border);
		border-radius: 12px;
		margin: 14px 0;
		overflow-wrap: anywhere;
	}
	.notice {
		border-left: 3px solid #c42b3b;
	}
	.view-switch {
		display: flex;
		gap: 8px;
		border-bottom: 1px solid var(--nw-border);
		padding-bottom: 14px;
		margin: 20px 0;
	}
	.view-switch .current {
		color: #bd2739;
		border-color: #c42b3b;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	.editor-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}
	.wide {
		grid-column: 1/-1;
	}
	label {
		display: grid;
		gap: 7px;
		font-size: 13px;
		min-width: 0;
	}
	input:not([type='checkbox']),
	select,
	textarea {
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
	textarea {
		resize: vertical;
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
	.workspace-body {
		display: grid;
		grid-template-columns: 210px minmax(0, 1fr);
		gap: 24px;
	}
	.workspace-main {
		min-width: 0;
	}
	.category-sidebar summary {
		min-height: 44px;
		padding: 8px 0 14px;
		cursor: pointer;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.category-sidebar summary small {
		font-weight: 400;
		margin-top: 6px;
	}
	:global([data-theme='dark']) .badges .inactive,
	:global([data-theme='dark']) .view-switch .current,
	:global([data-theme='dark']) .eyebrow {
		color: #ffabb5;
	}
	.category-sidebar {
		min-width: 0;
		border-right: 1px solid var(--nw-border);
		padding-right: 18px;
	}
	.category-sidebar > a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		border: 1px solid transparent;
		border-radius: 9px;
		color: var(--nw-text);
		padding: 10px;
		margin-bottom: 4px;
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.category-sidebar > a span:first-child {
		min-width: 0;
	}
	.category-sidebar > a.current {
		border-color: var(--nw-border);
		background: var(--nw-soft);
		font-weight: 700;
	}
	.category-sidebar small {
		display: block;
		color: var(--nw-muted);
		font-size: 11px;
	}
	.category-sidebar form {
		margin: 18px 0;
	}
	.category-sidebar form button {
		width: 100%;
		margin-top: 7px;
	}
	.filters {
		display: flex;
		align-items: end;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 18px;
	}
	.filters .search {
		flex: 1 1 220px;
	}
	.filters label:not(.search) {
		flex: 0 1 115px;
	}
	.filters button {
		flex: none;
	}
	.result-heading {
		align-items: center;
	}
	.navigation-list {
		display: grid;
		gap: 10px;
	}
	.navigation-row {
		border: 1px solid var(--nw-border);
		border-radius: 12px;
		padding: 16px;
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) auto;
		gap: 12px;
		align-items: start;
		background: var(--nw-bg);
	}
	.row-select {
		display: flex;
		align-items: center;
		min-height: 44px;
	}
	.link-info {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.link-info h4 {
		font-size: 15px;
		line-height: 1.5;
		padding-top: 2px;
	}
	.link-info h4 a {
		color: var(--nw-text);
	}
	.link-url {
		font-size: 12px;
		color: var(--nw-muted);
		margin-bottom: 6px !important;
	}
	.link-url small {
		display: block;
		font-size: 11px;
		overflow-wrap: anywhere;
		margin-top: 3px;
	}
	.summary {
		font-size: 13px;
		color: var(--nw-muted);
		white-space: pre-wrap;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.badges span {
		padding: 3px 7px;
		background: var(--nw-soft);
		border: 1px solid var(--nw-border);
		border-radius: 5px;
		font-size: 11px;
		color: var(--nw-muted);
	}
	.badges .inactive {
		color: #a02a36;
	}
	.row-actions {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
		max-width: 195px;
		justify-content: end;
	}
	.row-actions button {
		padding: 8px 11px;
	}
	.category-row {
		grid-template-columns: minmax(0, 1fr) auto;
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
	.pager {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: 16px;
		color: var(--nw-muted);
		font-size: 12px;
	}
	.pager > span {
		padding: 10px 2px;
	}
	.category-sidebar .pager a {
		padding: 8px;
		min-width: 44px;
	}
	.empty {
		padding: 35px 16px;
		border: 1px dashed var(--nw-border);
		border-radius: 12px;
		text-align: center;
	}
	.empty a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: #b62333;
	}
	.import-drawer {
		border-top: 1px solid var(--nw-border);
		padding-top: 18px;
		margin-top: 24px;
	}
	.import-drawer summary {
		cursor: pointer;
		min-height: 44px;
		padding: 10px;
		font-size: 14px;
		font-weight: 700;
	}
	.import-drawer :global(.bookmark-import) {
		margin-top: 16px;
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
	.discard-dialog {
		border: 1px solid #ccd1da;
		border-radius: 15px;
		max-width: 440px;
		width: calc(100% - 32px);
		padding: 24px;
		box-sizing: border-box;
		background: #fff;
		color: #252c36;
	}
	.discard-dialog::backdrop {
		background: #11182799;
	}
	.discard-dialog p {
		line-height: 1.7;
	}
	.discard-dialog button {
		--nw-bg: #fff;
		--nw-border: #ccd1da;
		--nw-text: #252c36;
	}
	:global([data-theme='dark']) .discard-dialog {
		background: #20252d;
		color: #edf0f5;
	}
	:global([data-theme='dark']) .discard-dialog button {
		--nw-bg: #20252d;
		--nw-border: #444d5b;
		--nw-text: #edf0f5;
	}
	@media (max-width: 900px) {
		.workspace-body {
			grid-template-columns: 170px minmax(0, 1fr);
			gap: 16px;
		}
		.navigation-row {
			grid-template-columns: 24px minmax(0, 1fr);
		}
		.row-actions {
			grid-column: 2;
			justify-content: start;
			max-width: none;
		}
		.category-row {
			grid-template-columns: minmax(0, 1fr);
		}
		.category-row .row-actions {
			grid-column: 1;
		}
		.workspace-header {
			flex-wrap: wrap;
		}
	}
	@media (max-width: 600px) {
		.workspace-body {
			grid-template-columns: minmax(0, 1fr);
		}
		.category-sidebar {
			border-right: 0;
			border-bottom: 1px solid var(--nw-border);
			padding: 0 0 16px;
		}
		.category-sidebar > a {
			padding: 8px 10px;
		}
		.editor-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.workspace-header,
		.result-heading {
			flex-direction: column;
		}
		.filters .search {
			flex-basis: 100%;
		}
		.filters label:not(.search) {
			flex: 1 1 100px;
		}
		.filters button {
			width: 100%;
		}
		.navigation-row {
			padding: 12px;
			gap: 8px;
		}
		.link-pager a {
			font-size: 12px;
			padding: 10px;
		}
		.panel,
		.notice {
			padding: 12px;
		}
	}
</style>
