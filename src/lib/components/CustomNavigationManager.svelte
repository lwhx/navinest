<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/toast.svelte';
	import { filterLinks } from '$lib/navigation-filter';
	let {
		navigation
	}: {
		navigation: {
			categories: Array<{ id: number; name: string; icon: string | null; sortOrder: number }>;
			links: Array<{
				id: number;
				categoryId: number | null;
				title: string;
				url: string;
				summary: string | null;
				sortOrder: number;
				status: 'active' | 'inactive';
			}>;
		};
	} = $props();
	let categoryName = $state(''),
		categorySort = $state(0),
		linkTitle = $state(''),
		linkUrl = $state(''),
		linkCategory = $state(''),
		linkSort = $state(0),
		importing = $state(false),
		query = $state(''),
		message = $state('');
	const visibleLinks = $derived(
		filterLinks(
			navigation.links.map((link) => ({
				...link,
				categoryName:
					navigation.categories.find((category) => category.id === link.categoryId)?.name ?? null
			})),
			query
		)
	);
	onMount(() => {
		const stored = sessionStorage.getItem('navinest-import-result');
		if (stored) {
			message = stored;
			sessionStorage.removeItem('navinest-import-result');
		}
	});
	async function importBookmarks(event: SubmitEvent) {
		event.preventDefault();
		const input = (event.currentTarget as HTMLFormElement).querySelector(
			'input[type="file"]'
		) as HTMLInputElement | null;
		const file = input?.files?.[0];
		if (!file) {
			message = '请选择浏览器导出的书签 HTML 文件。';
			return;
		}
		importing = true;
		try {
			const response = await fetch('/api/user/navigation/import', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ html: await file.text() })
			});
			const data = await response.json();
			if (!response.ok) {
				message = data.error ?? '导入失败，请重试。';
				showToast(message, 'error');
				return;
			}
			message = `导入完成：新增 ${data.imported} 条，跳过重复 ${data.duplicates} 条，忽略无效 ${data.skipped} 条${
				data.limited ? `，超出上限 ${data.limited} 条未导入` : ''
			}。`;
			showToast('书签导入完成。', 'success');
			await invalidateAll();
		} catch {
			message = '导入失败，请重试。';
			showToast(message, 'error');
		} finally {
			importing = false;
		}
	}
	async function request(method: string, body: Record<string, unknown>) {
		const response = await fetch('/api/user/navigation', {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await response.json();
		if (!response.ok) {
			message = data.error;
			showToast(data.error || '操作失败', 'error');
			return false;
		}
		message = '';
		showToast('操作成功。', 'success');
		await invalidateAll();
		return true;
	}
	function addCategory() {
		return request('POST', { resource: 'category', name: categoryName, sortOrder: categorySort });
	}
	function addLink() {
		return request('POST', {
			resource: 'link',
			title: linkTitle,
			url: linkUrl,
			categoryId: linkCategory || null,
			sortOrder: linkSort,
			status: 'active'
		});
	}
	function saveCategory(item: {
		id: number;
		name: string;
		icon: string | null;
		sortOrder: number;
	}) {
		return request('PATCH', { resource: 'category', ...item });
	}
	function saveLink(item: {
		id: number;
		categoryId: number | null;
		title: string;
		url: string;
		summary: string | null;
		sortOrder: number;
		status: string;
	}) {
		return request('PATCH', { resource: 'link', ...item });
	}
	function remove(resource: 'category' | 'link', id: number) {
		return request('DELETE', { resource, id });
	}
	function position(kind: 'category' | 'link', id: number) {
		const list = kind === 'link' ? navigation.links : navigation.categories;
		return list.findIndex((item) => item.id === id);
	}
	function move(kind: 'category' | 'link', id: number, delta: -1 | 1) {
		const list: Array<{ id: number }> =
			kind === 'link' ? [...navigation.links] : [...navigation.categories];
		const index = list.findIndex((item) => item.id === id);
		const target = index + delta;
		if (index < 0 || target < 0 || target >= list.length) return;
		[list[index], list[target]] = [list[target], list[index]];
		return request('PATCH', { resource: 'order', kind, ids: list.map((item) => item.id) });
	}
</script>

<section class="account-card" aria-labelledby="custom-navigation-title">
	<h2 id="custom-navigation-title">自定义导航</h2>
	{#if message}<p class="admin-form-message" role="alert">{message}</p>{/if}
	<form class="account-form" onsubmit={importBookmarks}>
		<h3>导入浏览器书签</h3>
		<p>
			支持 Chrome、Edge、Firefox、Safari 导出的 HTML
			书签文件；书签文件夹会成为分类，重复网址会自动跳过，单次最多导入 500 条。
		</p>
		<label><span>书签文件</span><input type="file" accept=".html,.htm,text/html" /></label><button
			class="account-button"
			type="submit"
			disabled={importing}>{importing ? '正在导入…' : '导入书签'}</button
		>
	</form>
	<form
		class="account-form"
		onsubmit={(event) => {
			event.preventDefault();
			addCategory();
		}}
	>
		<h3>新增分类</h3>
		<label><span>名称</span><input bind:value={categoryName} required maxlength="80" /></label
		><label><span>排序</span><input bind:value={categorySort} type="number" /></label><button
			class="account-button"
			type="submit">添加分类</button
		>
	</form>
	{#each navigation.categories as category (category.id)}
		<form
			class="account-form"
			onsubmit={(event) => {
				event.preventDefault();
				saveCategory(category);
			}}
		>
			<label
				><span>分类名称</span><input bind:value={category.name} maxlength="80" required /></label
			><label><span>排序</span><input bind:value={category.sortOrder} type="number" /></label>
			<div class="account-actions">
				<button
					class="account-button secondary"
					type="button"
					disabled={position('category', category.id) === 0}
					aria-label="上移分类"
					onclick={() => move('category', category.id, -1)}>↑</button
				><button
					class="account-button secondary"
					type="button"
					disabled={position('category', category.id) === navigation.categories.length - 1}
					aria-label="下移分类"
					onclick={() => move('category', category.id, 1)}>↓</button
				><button class="account-button" type="submit">保存</button><button
					class="account-button secondary"
					type="button"
					onclick={() => remove('category', category.id)}>删除</button
				>
			</div>
		</form>
	{/each}
	<form
		class="account-form"
		onsubmit={(event) => {
			event.preventDefault();
			addLink();
		}}
	>
		<h3>新增链接</h3>
		<label><span>标题</span><input bind:value={linkTitle} required maxlength="120" /></label><label
			><span>网址</span><input bind:value={linkUrl} type="url" required /></label
		><label
			><span>分类</span><select bind:value={linkCategory}
				><option value="">未分类</option
				>{#each navigation.categories as category (category.id)}<option value={String(category.id)}
						>{category.name}</option
					>{/each}</select
			></label
		><label><span>排序</span><input bind:value={linkSort} type="number" /></label><button
			class="account-button"
			type="submit">添加链接</button
		>
	</form>
	<form class="account-form" onsubmit={(event) => event.preventDefault()}>
		<h3>搜索链接</h3>
		<label
			><span>关键字</span><input
				bind:value={query}
				type="search"
				placeholder="标题、网址、摘要或分类"
			/></label
		>
		<p class="account-muted">匹配 {visibleLinks.length} / {navigation.links.length} 条链接。</p>
	</form>
	{#each visibleLinks as link (link.id)}
		<form
			class="account-form"
			onsubmit={(event) => {
				event.preventDefault();
				saveLink(link);
			}}
		>
			<label><span>标题</span><input bind:value={link.title} maxlength="120" required /></label
			><label><span>网址</span><input bind:value={link.url} type="url" required /></label><label
				><span>分类</span><select
					value={link.categoryId === null ? '' : String(link.categoryId)}
					onchange={(event) =>
						(link.categoryId = (event.currentTarget as HTMLSelectElement).value
							? Number((event.currentTarget as HTMLSelectElement).value)
							: null)}
					><option value="">未分类</option
					>{#each navigation.categories as category (category.id)}<option
							value={String(category.id)}>{category.name}</option
						>{/each}</select
				></label
			><label><span>排序</span><input bind:value={link.sortOrder} type="number" /></label><label
				><span>状态</span><select bind:value={link.status}
					><option value="active">启用</option><option value="inactive">停用</option></select
				></label
			>
			<div class="account-actions">
				<button
					class="account-button secondary"
					type="button"
					disabled={position('link', link.id) === 0}
					aria-label="上移链接"
					onclick={() => move('link', link.id, -1)}>↑</button
				><button
					class="account-button secondary"
					type="button"
					disabled={position('link', link.id) === navigation.links.length - 1}
					aria-label="下移链接"
					onclick={() => move('link', link.id, 1)}>↓</button
				><a
					class="account-button secondary"
					href={resolve(`/go?url=${encodeURIComponent(link.url)}` as '/')}
					target="_blank"
					rel="external noopener noreferrer">访问</a
				><button class="account-button" type="submit">保存</button><button
					class="account-button secondary"
					type="button"
					onclick={() => remove('link', link.id)}>删除</button
				>
			</div>
		</form>
	{/each}
</section>
