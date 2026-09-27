<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import AccountShell from '$lib/components/AccountShell.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type SessionSummary = (typeof data)['sessions'][number];

	let currentPassword = $state(''),
		newPassword = $state(''),
		confirmPassword = $state(''),
		passwordMessage = $state(''),
		passwordError = $state({} as Record<string, string>),
		passwordSaving = $state(false);

	let sessions = $state<SessionSummary[]>([]),
		sessionMessage = $state(''),
		sessionError = $state(''),
		sessionsBusy = $state(false);

	let github = $state(false),
		bindingMessage = $state(''),
		bindingError = $state(''),
		bindingBusy = $state(false);

	let deactivateOpen = $state(false),
		deactivatePassword = $state(''),
		deactivateConfirmation = $state(''),
		deactivateMessage = $state(''),
		deactivateError = $state(''),
		deactivateBusy = $state(false);

	let shareSlug = $state(''),
		shareEnabled = $state(false),
		shareMessage = $state(''),
		shareError = $state(''),
		shareBusy = $state(false);

	onMount(() => {
		sessions = data.sessions;
		github = data.github;
		shareSlug = data.share.slug;
		shareEnabled = data.share.enabled;
	});

	async function saveShare(event: SubmitEvent) {
		event.preventDefault();
		shareBusy = true;
		shareMessage = '';
		shareError = '';
		const { response, body } = await send('/api/user/share', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ slug: shareSlug, enabled: shareEnabled })
		});
		shareBusy = false;
		if (!response.ok) {
			shareError = String(body.error ?? '保存分享设置失败，请稍后重试。');
			return;
		}
		const saved = body.data as { slug: string; enabled: boolean };
		shareSlug = saved.slug;
		shareEnabled = saved.enabled;
		shareMessage = saved.enabled
			? `分享页已开启：/u/${saved.slug}`
			: '分享设置已保存，当前未对外展示。';
	}

	function deviceLabel(agent: string | null) {
		if (!agent) return '未知设备';
		const browser = /Edg\//.test(agent)
			? 'Edge'
			: /OPR\//.test(agent)
				? 'Opera'
				: /Chrome\//.test(agent)
					? 'Chrome'
					: /Firefox\//.test(agent)
						? 'Firefox'
						: /Safari\//.test(agent)
							? 'Safari'
							: '浏览器';
		const system = /Windows/.test(agent)
			? 'Windows'
			: /Macintosh|Mac OS X/.test(agent)
				? 'macOS'
				: /Android/.test(agent)
					? 'Android'
					: /iPhone|iPad/.test(agent)
						? 'iOS'
						: /Linux/.test(agent)
							? 'Linux'
							: '未知系统';
		return `${browser} · ${system}`;
	}

	function stamp(value: string) {
		return value.replace('T', ' ').replace('Z', '').slice(0, 16);
	}

	async function send(url: string, init: RequestInit) {
		const response = await fetch(url, init);
		let body: Record<string, unknown> = {};
		try {
			body = (await response.json()) as Record<string, unknown>;
		} catch {
			// Non-JSON responses (for example a proxy error page) keep the empty body.
		}
		return { response, body };
	}

	async function savePassword(event: SubmitEvent) {
		event.preventDefault();
		passwordSaving = true;
		passwordMessage = '';
		passwordError = {};
		const { response, body } = await send('/api/user/password', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
		});
		passwordSaving = false;
		if (!response.ok) {
			passwordError = (body.fields as Record<string, string>) ?? {};
			passwordMessage = String(body.error ?? '密码修改失败，请稍后重试。');
			return;
		}
		currentPassword = newPassword = confirmPassword = '';
		passwordMessage = `密码已更新，其他设备上的 ${Number(body.revokedSessions ?? 0)} 个会话已注销。`;
	}

	async function refreshSessions() {
		const { response, body } = await send('/api/user/sessions', { method: 'GET' });
		if (response.ok) sessions = (body.data as typeof sessions) ?? [];
	}

	async function revokeSession(id: string) {
		sessionsBusy = true;
		sessionMessage = '';
		sessionError = '';
		const { response, body } = await send(`/api/user/sessions/${id}`, { method: 'DELETE' });
		sessionsBusy = false;
		if (!response.ok) {
			sessionError = String(body.error ?? '注销会话失败，请稍后重试。');
			return;
		}
		if (body.wasCurrent) {
			location.href = resolve('/login');
			return;
		}
		sessionMessage = '该会话已注销。';
		await refreshSessions();
	}

	async function revokeOthers() {
		sessionsBusy = true;
		sessionMessage = '';
		sessionError = '';
		const { response, body } = await send('/api/user/sessions/revoke-others', { method: 'POST' });
		sessionsBusy = false;
		if (!response.ok) {
			sessionError = String(body.error ?? '注销会话失败，请稍后重试。');
			return;
		}
		sessionMessage = `已注销其他 ${Number(body.revoked ?? 0)} 个会话。`;
		await refreshSessions();
	}

	async function unbindGithub() {
		bindingBusy = true;
		bindingMessage = '';
		bindingError = '';
		const { response, body } = await send('/api/user/oauth/github', { method: 'DELETE' });
		bindingBusy = false;
		if (!response.ok) {
			bindingError = String(body.error ?? '解绑失败，请稍后重试。');
			return;
		}
		github = false;
		bindingMessage = 'GitHub 账号已解绑，之后请使用账号密码登录。';
	}

	async function deactivate(event: SubmitEvent) {
		event.preventDefault();
		deactivateBusy = true;
		deactivateMessage = '';
		deactivateError = '';
		const { response, body } = await send('/api/user/deactivate', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password: deactivatePassword, confirmation: deactivateConfirmation })
		});
		deactivateBusy = false;
		if (!response.ok) {
			deactivateError = String(body.error ?? '注销失败，请稍后重试。');
			return;
		}
		deactivateMessage = '账号已停用，正在返回首页。';
		location.href = resolve('/');
	}
</script>

<svelte:head><title>账号安全 | NaviNest 导航巢</title></svelte:head>
<AccountShell
	title="账号安全"
	description="管理登录密码、活跃会话、第三方绑定和账号状态。"
	eyebrow="SECURITY"
	role={data.user.role}
>
	<div class="account-grid">
		<section class="account-card" aria-labelledby="password-title">
			<div class="account-card-header">
				<div>
					<h2 id="password-title">修改密码</h2>
					<p>修改成功后，其他设备上的登录会话会被自动注销。</p>
				</div>
			</div>
			{#if !data.hasPassword}
				<p class="account-note">
					当前账号还没有设置密码，无法在这里修改。请让管理员先在后台为用户设置密码。
				</p>
			{:else}
				{#if passwordMessage}<p class="account-note" role="status">{passwordMessage}</p>{/if}
				<form class="account-form" onsubmit={savePassword}>
					<div class="account-wide">
						<label class="account-field"
							><span>当前密码</span><input
								type="password"
								autocomplete="current-password"
								bind:value={currentPassword}
								required
							/>{#if passwordError.currentPassword}<small class="field-error"
									>{passwordError.currentPassword}</small
								>{/if}</label
						>
					</div>
					<label class="account-field"
						><span>新密码</span><input
							type="password"
							autocomplete="new-password"
							bind:value={newPassword}
							minlength="8"
							maxlength="128"
							required
						/>{#if passwordError.newPassword}<small class="field-error"
								>{passwordError.newPassword}</small
							>{/if}</label
					>
					<label class="account-field"
						><span>确认新密码</span><input
							type="password"
							autocomplete="new-password"
							bind:value={confirmPassword}
							minlength="8"
							maxlength="128"
							required
						/>{#if passwordError.confirmPassword}<small class="field-error"
								>{passwordError.confirmPassword}</small
							>{/if}</label
					>
					<div class="account-wide account-actions">
						<button class="account-button" type="submit" disabled={passwordSaving}>
							{passwordSaving ? '保存中…' : '更新密码'}
						</button>
						<span class="account-muted">密码至少 8 位，且不能包含用户名。</span>
					</div>
				</form>
			{/if}
		</section>

		<section class="account-card" aria-labelledby="binding-title">
			<div class="account-card-header">
				<div>
					<h2 id="binding-title">第三方登录</h2>
					<p>GitHub 账号用于快捷登录，解绑后请确保仍能用密码登录。</p>
				</div>
				<span class="account-status {github ? 'published' : ''}"
					>{github ? '已绑定' : '未绑定'}</span
				>
			</div>
			{#if bindingMessage}<p class="account-note" role="status">{bindingMessage}</p>{/if}
			{#if bindingError}<p class="account-note danger-note" role="alert">{bindingError}</p>{/if}
			<ul class="account-list">
				<li>
					<div>
						<strong>GitHub</strong>
						<p>
							{github ? '已绑定 GitHub 账号，可直接使用 GitHub 登录。' : '尚未绑定 GitHub 账号。'}
						</p>
					</div>
					{#if github}<button
							class="account-button secondary"
							type="button"
							disabled={bindingBusy || !data.hasPassword}
							onclick={unbindGithub}
							title={data.hasPassword ? '' : '请先设置密码后再解绑'}
						>
							{bindingBusy ? '处理中…' : '解绑'}
						</button>{/if}
				</li>
			</ul>
			{#if !data.hasPassword}<p class="account-muted">
					该账号没有密码，解绑 GitHub 后将无法登录，因此当前不可解绑。
				</p>{/if}
		</section>
	</div>

	<section class="account-card" aria-labelledby="share-title">
		<div class="account-card-header">
			<div>
				<h2 id="share-title">公开分享页</h2>
				<p>开启后可以用 /u/你的地址 对外分享自定义导航，只展示状态为“启用”的链接。</p>
			</div>
			<span class="account-status {shareEnabled ? 'published' : ''}"
				>{shareEnabled ? '已公开' : '未公开'}</span
			>
		</div>
		{#if shareMessage}<p class="account-note" role="status">{shareMessage}</p>{/if}
		{#if shareError}<p class="account-note danger-note" role="alert">{shareError}</p>{/if}
		<form class="account-form" onsubmit={saveShare}>
			<label class="account-wide"
				><span>分享地址</span><input
					bind:value={shareSlug}
					maxlength="30"
					placeholder="例如 my-links"
					autocomplete="off"
				/>
				<small class="account-muted"
					>3–30 位小写字母、数字或连字符；开启后可访问 /u/{shareSlug || '你的地址'}。</small
				></label
			>
			<label class="account-wide share-toggle"
				><input type="checkbox" bind:checked={shareEnabled} /><span>允许任何人访问该分享页</span
				></label
			>
			<div class="account-actions">
				<button class="account-button" type="submit" disabled={shareBusy}
					>{shareBusy ? '保存中…' : '保存分享设置'}</button
				>
			</div>
		</form>
	</section>

	<section class="account-card" aria-labelledby="sessions-title">
		<div class="account-card-header">
			<div>
				<h2 id="sessions-title">登录会话</h2>
				<p>共 {sessions.length} 个有效会话，时间为 UTC。发现陌生设备时请立即注销。</p>
			</div>
			<button
				class="account-button secondary"
				type="button"
				disabled={sessionsBusy || sessions.length <= 1}
				onclick={revokeOthers}>注销其他会话</button
			>
		</div>
		{#if sessionMessage}<p class="account-note" role="status">{sessionMessage}</p>{/if}
		{#if sessionError}<p class="account-note danger-note" role="alert">{sessionError}</p>{/if}
		{#if sessions.length}
			<ul class="account-list session-list">
				{#each sessions as session (session.id)}
					<li>
						<div>
							<strong>{deviceLabel(session.userAgent)}</strong>
							{#if session.current}<span class="account-badge current-badge">当前会话</span>{/if}
							<p>
								登录于 <time datetime={session.createdAt}>{stamp(session.createdAt)}</time> ·
								最近活动
								<time datetime={session.lastSeenAt}>{stamp(session.lastSeenAt)}</time>
							</p>
							<p>
								到期 <time datetime={session.expiresAt}>{stamp(session.expiresAt)}</time>
								{#if session.ipAddress}· 来源 {session.ipAddress}{/if}
							</p>
						</div>
						<button
							class="account-button secondary"
							type="button"
							disabled={sessionsBusy}
							onclick={() => revokeSession(session.id)}
						>
							{session.current ? '退出该会话' : '注销'}
						</button>
					</li>
				{/each}
			</ul>
		{:else}<p class="account-empty">没有可管理的有效会话。</p>{/if}
	</section>

	<section class="account-card danger-zone" aria-labelledby="deactivate-title">
		<div class="account-card-header">
			<div>
				<h2 id="deactivate-title">停用账号</h2>
				<p>停用后立即退出所有设备，账号数据保留，可由管理员重新启用。</p>
			</div>
		</div>
		{#if deactivateMessage}<p class="account-note" role="status">{deactivateMessage}</p>{/if}
		{#if deactivateError}<p class="account-note danger-note" role="alert">{deactivateError}</p>{/if}
		{#if !deactivateOpen}
			<button class="account-button danger" type="button" onclick={() => (deactivateOpen = true)}>
				停用我的账号
			</button>
		{:else}
			<form class="account-form" onsubmit={deactivate}>
				{#if data.hasPassword}
					<label class="account-field"
						><span>当前密码</span><input
							type="password"
							autocomplete="current-password"
							bind:value={deactivatePassword}
							required
						/></label
					>
				{:else}
					<label class="account-field"
						><span>输入用户名确认</span><input
							bind:value={deactivateConfirmation}
							placeholder={data.user.username}
							required
						/></label
					>
				{/if}
				<div class="account-wide account-actions">
					<button class="account-button danger" type="submit" disabled={deactivateBusy}>
						{deactivateBusy ? '处理中…' : '确认停用账号'}
					</button>
					<button
						class="account-button secondary"
						type="button"
						onclick={() => {
							deactivateOpen = false;
							deactivatePassword = '';
							deactivateConfirmation = '';
							deactivateError = '';
						}}>取消</button
					>
				</div>
			</form>
		{/if}
	</section>
</AccountShell>

<style>
	.session-list li {
		align-items: center;
	}

	.current-badge {
		margin-left: 8px;
	}

	.field-error {
		color: #c5323c;
		font-weight: 600;
	}

	.danger-note {
		background: #fff0f1;
		color: #a92933;
	}

	.danger-zone {
		border-color: rgba(197, 50, 60, 0.28);
	}

	.account-button.danger {
		background: #c5323c;
	}

	.account-button.danger:hover {
		background: #a92933;
	}
</style>
