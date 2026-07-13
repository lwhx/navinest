<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import CustomNavigationManager from '$lib/components/CustomNavigationManager.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let displayName = $state(''),
		email = $state(''),
		avatarFileId = $state<number | null>(null),
		coverFileId = $state<number | null>(null),
		message = $state('');
	onMount(() => {
		displayName = data.profile?.display_name ?? data.user.displayName;
		email = data.profile?.email ?? data.user.email ?? '';
		avatarFileId = data.profile?.avatar_file_id ?? null;
		coverFileId = data.profile?.cover_file_id ?? null;
	});
	async function save(reload = true) {
		const response = await fetch('/api/user/profile', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ displayName, email, avatarFileId, coverFileId })
		});
		const body = await response.json();
		message = response.ok ? '资料已保存。' : body.error;
		if (response.ok && reload) location.reload();
		return response.ok;
	}
	async function upload(event: Event, kind: 'avatar' | 'cover') {
		const input = event.currentTarget as HTMLInputElement,
			file = input.files?.[0];
		if (!file) return;
		const form = new FormData();
		form.append('file', file);
		const response = await fetch('/api/user/files', { method: 'POST', body: form }),
			body = await response.json();
		if (!response.ok) {
			message = body.error;
			return;
		}
		const previousId = kind === 'avatar' ? avatarFileId : coverFileId;
		if (kind === 'avatar') avatarFileId = body.data.id;
		else coverFileId = body.data.id;
		if (await save(false)) {
			if (previousId) await fetch(`/api/user/files/${previousId}`, { method: 'DELETE' });
			location.reload();
		}
	}
	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		location.href = resolve('/');
	}
	function activityPath(item: { type: string; slug: string }) {
		const prefixes: Record<string, string> = {
			site: 'sites',
			post: 'posts',
			app: 'apps',
			book: 'books',
			bulletin: 'bulletins'
		};
		return `/${prefixes[item.type]}/${encodeURIComponent(item.slug)}`;
	}
</script>

<svelte:head><title>用户中心 | NaviNest 导航巢</title></svelte:head>
<AccountShell
	title="个人空间"
	description="管理你的资料、收藏、浏览记录和专属导航。"
	role={data.user.role}
>
	<div class="account-grid">
		<section class="account-card">
			<div class="account-profile-media">
				{#if data.profile?.cover_file_id}<img
						class="profile-cover"
						src={resolve(`/api/user/files/${data.profile.cover_file_id}` as '/')}
						alt="用户封面"
					/>{/if}
				{#if data.profile?.avatar_file_id}<img
						class="profile-avatar"
						src={resolve(`/api/user/files/${data.profile.avatar_file_id}` as '/')}
						alt="用户头像"
					/>{:else}<span class="account-profile-fallback">{data.user.displayName.slice(0, 1)}</span
					>{/if}
			</div>
			<div class="account-card-header">
				<div>
					<h2>{data.user.displayName}</h2>
					<p>@{data.user.username}</p>
				</div>
				<span class="account-badge">{data.user.role}</span>
			</div>
			{#if message}<p class="account-note" role="status">{message}</p>{/if}
			<form
				class="account-form"
				onsubmit={(event) => {
					event.preventDefault();
					save();
				}}
			>
				<label
					><span>显示名称</span><input bind:value={displayName} maxlength="80" required /></label
				>
				<label><span>邮箱</span><input bind:value={email} type="email" /></label>
				<label
					><span>头像图片</span><input
						type="file"
						accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
						onchange={(event) => upload(event, 'avatar')}
					/><small>文件 ID：{avatarFileId ?? '未设置'}</small></label
				>
				<label
					><span>封面图片</span><input
						type="file"
						accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
						onchange={(event) => upload(event, 'cover')}
					/><small>文件 ID：{coverFileId ?? '未设置'}</small></label
				>
				<div class="account-wide account-actions">
					<button class="account-button" type="submit">保存资料</button><button
						class="account-button secondary"
						type="button"
						onclick={logout}>退出登录</button
					>
				</div>
			</form>
		</section>
		<aside class="account-card">
			<div class="account-card-header">
				<div>
					<h2>账户概览</h2>
					<p>你的NaviNest使用状态</p>
				</div>
			</div>
			<div class="account-stats">
				<div class="account-stat">
					<strong>{data.favorites.length}</strong><span>收藏内容</span>
				</div>
				<div class="account-stat">
					<strong>{data.footprints.length}</strong><span>最近浏览</span>
				</div>
			</div>
			<ul class="account-list">
				<li>
					<div>
						<strong>GitHub账户</strong>
						<p>{data.github ? '已完成绑定，可用于快捷登录。' : '尚未绑定GitHub账户。'}</p>
					</div>
					<span class="account-status {data.github ? 'published' : ''}"
						>{data.github ? '已绑定' : '未绑定'}</span
					>
				</li>
				<li>
					<div>
						<strong>内容贡献</strong>
						<p>提交优质网址、文章、应用或书籍。</p>
					</div>
					<a href={resolve('/contribute')}>立即投稿</a>
				</li>
				{#if data.user.role === 'admin'}<li class="admin-overview-entry">
						<div>
							<strong>后台管理</strong>
							<p>管理内容、分类、投稿、文件和运行状态。</p>
						</div>
						<a href={resolve('/admin')}>进入后台</a>
					</li>{/if}
			</ul>
		</aside>
	</div>
	<div class="account-grid">
		<section class="account-card" aria-labelledby="favorites-title">
			<div class="account-card-header">
				<div>
					<h2 id="favorites-title">我的收藏</h2>
					<p>快速回到你保存的内容</p>
				</div>
			</div>
			{#if data.favorites.length}<ul class="account-list">
					{#each data.favorites as item (item.id)}<li>
							<div>
								<a href={resolve(activityPath(item) as '/')}>{item.title}</a>{#if item.summary}<p>
										{item.summary}
									</p>{/if}
							</div>
							<span class="account-status">{item.type}</span>
						</li>{/each}
				</ul>{:else}<p class="account-empty">暂无收藏，浏览内容详情时可以加入收藏。</p>{/if}
		</section>
		<section class="account-card" aria-labelledby="footprints-title">
			<div class="account-card-header">
				<div>
					<h2 id="footprints-title">最近浏览</h2>
					<p>继续上次的探索</p>
				</div>
			</div>
			{#if data.footprints.length}<ul class="account-list">
					{#each data.footprints as item (item.id)}<li>
							<div>
								<a href={resolve(activityPath(item) as '/')}>{item.title}</a><time
									datetime={item.visitedAt}>{item.visitedAt}</time
								>
							</div>
						</li>{/each}
				</ul>{:else}<p class="account-empty">暂无浏览记录。</p>{/if}
		</section>
	</div>
	<CustomNavigationManager navigation={data.navigation} />
</AccountShell>
