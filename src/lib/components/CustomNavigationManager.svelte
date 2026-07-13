<script lang="ts">
	import { resolve } from '$app/paths';
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
		message = $state('');
	async function request(method: string, body: Record<string, unknown>) {
		const response = await fetch('/api/user/navigation', {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await response.json();
		if (!response.ok) {
			message = data.error;
			return false;
		}
		location.reload();
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
</script>

<section class="account-card" aria-labelledby="custom-navigation-title">
	<h2 id="custom-navigation-title">自定义导航</h2>
	{#if message}<p class="admin-form-message" role="alert">{message}</p>{/if}
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
				<button class="account-button" type="submit">保存</button><button
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
	{#each navigation.links as link (link.id)}
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
				<a
					class="account-button secondary"
					href={resolve(`/go?url=${encodeURIComponent(link.url)}` as '/')}>访问</a
				><button class="account-button" type="submit">保存</button><button
					class="account-button secondary"
					type="button"
					onclick={() => remove('link', link.id)}>删除</button
				>
			</div>
		</form>
	{/each}
</section>
