<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);

	let search = $state(''),
		roleFilter = $state('all'),
		statusFilter = $state('all');

	const filtered = $derived(
		data.users.filter((user) => {
			if (roleFilter !== 'all' && user.role !== roleFilter) return false;
			if (statusFilter !== 'all' && user.status !== statusFilter) return false;
			if (!search.trim()) return true;
			const needle = search.trim().toLowerCase();
			return [user.username, user.displayName, user.email ?? ''].some((field) =>
				field.toLowerCase().includes(needle)
			);
		})
	);

	function value(name: string, fallback = ''): string {
		const submitted = form?.values?.[name];
		return typeof submitted === 'string' ? submitted : fallback;
	}

	function stamp(input: string | null) {
		if (!input) return '—';
		return input.replace('T', ' ').replace('Z', '').slice(0, 16);
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Accounts</p>
		<h1>用户管理</h1>
		<p class="admin-page-note">
			共 {data.users.length} 个账号，其中 {filtered.length} 个符合当前筛选。站点必须保留至少一个可用管理员。
		</p>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/users?create=1')}>新增用户</a
		>{/if}
</header>
{#if data.source === 'fallback'}<p class="admin-notice">本地示例为只读数据。</p>{/if}
{#if form?.message && !data.mode && !data.passwordFor}
	<p class="admin-form-message" role="alert">{form.message}</p>
{/if}

{#if data.source === 'database' && data.mode}
	<section class="admin-editor" aria-labelledby="user-editor-title">
		<div class="admin-editor-header">
			<h2 id="user-editor-title">{data.mode === 'create' ? '新增用户' : '编辑用户'}</h2>
			<a href={resolve('/admin/users')} aria-label="关闭编辑器" title="关闭">×</a>
		</div>
		{#if data.mode === 'create' || data.editing}
			<form
				class="admin-form"
				method="POST"
				action={data.mode === 'create' ? '?create=1&/create' : `?edit=${data.editing?.id}&/update`}
			>
				{#if data.editing}<input type="hidden" name="id" value={data.editing.id} />{/if}
				{#if form?.message}<p class="admin-form-message" role="alert">{form.message}</p>{/if}
				<div class="admin-form-grid">
					<label
						><span>用户名</span><input
							name="username"
							maxlength="32"
							autocomplete="off"
							required
							value={value('username', data.editing?.username)}
						/>{#if errors.username}<small class="field-error">{errors.username}</small>{/if}</label
					>
					<label
						><span>显示名称</span><input
							name="displayName"
							maxlength="80"
							required
							value={value('displayName', data.editing?.displayName)}
						/>{#if errors.displayName}<small class="field-error">{errors.displayName}</small
							>{/if}</label
					>
					<label
						><span>邮箱</span><input
							name="email"
							type="email"
							maxlength="160"
							value={value('email', data.editing?.email ?? '')}
						/>{#if errors.email}<small class="field-error">{errors.email}</small>{/if}</label
					>
					<label
						><span>角色</span><select
							name="role"
							value={value('role', data.editing?.role ?? 'user')}
							><option value="user">普通用户</option><option value="admin">管理员</option></select
						>{#if errors.role}<small class="field-error">{errors.role}</small>{/if}</label
					>
					<label
						><span>状态</span><select
							name="status"
							value={value('status', data.editing?.status ?? 'active')}
							><option value="active">启用</option><option value="disabled">停用</option></select
						>{#if errors.status}<small class="field-error">{errors.status}</small>{/if}</label
					>
					{#if data.mode === 'create'}
						<label
							><span>初始密码</span><input
								name="password"
								type="password"
								autocomplete="new-password"
								minlength="8"
								maxlength="128"
								required
							/>{#if errors.password}<small class="field-error">{errors.password}</small
								>{/if}</label
						>
					{:else}<p class="admin-field-wide admin-form-hint">
							密码不在此处修改，请使用列表中的“重置密码”。
						</p>{/if}
				</div>
				<div class="admin-form-actions">
					<button class="admin-primary-button" type="submit">
						{data.mode === 'create' ? '创建用户' : '保存用户'}
					</button>
					<a class="admin-secondary-button" href={resolve('/admin/users')}>取消</a>
				</div>
			</form>
		{:else}<p class="admin-notice">没有找到要编辑的用户。</p>{/if}
	</section>
{/if}

{#if data.source === 'database' && data.passwordFor}
	<section class="admin-editor" aria-labelledby="user-password-title">
		<div class="admin-editor-header">
			<h2 id="user-password-title">重置密码：{data.passwordFor.displayName}</h2>
			<a href={resolve('/admin/users')} aria-label="关闭编辑器" title="关闭">×</a>
		</div>
		<form class="admin-form" method="POST" action={`?password=${data.passwordFor.id}&/password`}>
			<input type="hidden" name="id" value={data.passwordFor.id} />
			{#if form?.message}<p class="admin-form-message" role="alert">{form.message}</p>{/if}
			<div class="admin-form-grid">
				<label
					><span>新密码</span><input
						name="password"
						type="password"
						autocomplete="new-password"
						minlength="8"
						maxlength="128"
						required
					/>{#if errors.password}<small class="field-error">{errors.password}</small>{/if}</label
				>
			</div>
			<p class="admin-form-hint">重置后该用户的全部登录会话会立即失效，需要用新密码重新登录。</p>
			<div class="admin-form-actions">
				<button class="admin-primary-button" type="submit">重置密码</button>
				<a class="admin-secondary-button" href={resolve('/admin/users')}>取消</a>
			</div>
		</form>
	</section>
{/if}

<div class="admin-filter-bar">
	<label
		><span class="visually-hidden">搜索用户</span><input
			class="user-search"
			type="search"
			placeholder="搜索用户名、显示名称或邮箱"
			bind:value={search}
		/></label
	>
	<label
		><span class="visually-hidden">角色筛选</span><select bind:value={roleFilter}
			><option value="all">全部角色</option><option value="admin">管理员</option><option
				value="user">普通用户</option
			></select
		></label
	>
	<label
		><span class="visually-hidden">状态筛选</span><select bind:value={statusFilter}
			><option value="all">全部状态</option><option value="active">启用</option><option
				value="disabled">停用</option
			></select
		></label
	>
</div>

<div class="admin-table-wrap">
	<table class="admin-table">
		<thead
			><tr
				><th>用户</th><th>角色</th><th>状态</th><th>登录方式</th><th>会话</th><th>活动</th><th
					>最近登录</th
				>{#if data.source === 'database'}<th>操作</th>{/if}</tr
			></thead
		><tbody
			>{#each filtered as user (user.id)}<tr>
					<td>
						<strong>{user.displayName}</strong>
						<small class="admin-user-meta"
							>@{user.username}{user.email ? ` · ${user.email}` : ''}</small
						>
						{#if user.id === data.currentAdminId}<span class="account-badge">当前账号</span>{/if}
					</td>
					<td>{user.role === 'admin' ? '管理员' : '普通用户'}</td>
					<td>
						<span class="account-status {user.status === 'active' ? 'published' : 'rejected'}"
							>{user.status === 'active' ? '启用' : '停用'}</span
						>
					</td>
					<td>{user.github ? '密码 + GitHub' : '密码'}</td>
					<td>{user.sessions}</td>
					<td class="admin-user-activity"
						>{user.favorites} 收藏 · {user.footprints} 足迹 · {user.submissions} 投稿</td
					>
					<td><time datetime={user.lastLoginAt ?? ''}>{stamp(user.lastLoginAt)}</time></td>
					{#if data.source === 'database'}<td>
							<div class="admin-row-actions">
								<a href={resolve(`/admin/users?edit=${user.id}`)}>编辑</a>
								<a href={resolve(`/admin/users?password=${user.id}`)}>重置密码</a>
								<form
									method="POST"
									action="?/status"
									onsubmit={(event) => {
										if (
											!confirm(
												user.status === 'active'
													? `确定停用“${user.displayName}”？停用后其全部会话立即失效。`
													: `确定重新启用“${user.displayName}”？`
											)
										)
											event.preventDefault();
									}}
								>
									<input type="hidden" name="id" value={user.id} />
									<input
										type="hidden"
										name="status"
										value={user.status === 'active' ? 'disabled' : 'active'}
									/>
									<button type="submit">{user.status === 'active' ? '停用' : '启用'}</button>
								</form>
							</div>
						</td>{/if}
				</tr>{/each}
			{#if !filtered.length}<tr
					><td colspan="8" class="admin-user-empty">没有符合条件的用户。</td></tr
				>{/if}
		</tbody>
	</table>
</div>

<style>
	.admin-page-note {
		margin: 6px 0 0;
		color: #7b8087;
		font-size: 13px;
	}

	.admin-filter-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 14px;
	}

	.admin-filter-bar input,
	.admin-filter-bar select {
		min-height: 40px;
		border: 1px solid #e4e7eb;
		border-radius: 10px;
		padding: 0 12px;
		background: #fbfcfd;
		color: #34383e;
		font: inherit;
	}

	.user-search {
		min-width: 280px;
	}

	.admin-user-meta {
		display: block;
		margin-top: 2px;
		color: #8b8f95;
		font-size: 12px;
	}

	.admin-user-activity {
		color: #5f646b;
		font-size: 13px;
	}

	.admin-user-empty {
		text-align: center;
		color: #8b8f95;
	}

	.admin-form-hint {
		margin: 0;
		color: #7b8087;
		font-size: 13px;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 900px) {
		.user-search {
			min-width: 0;
			flex: 1;
		}
	}
</style>
