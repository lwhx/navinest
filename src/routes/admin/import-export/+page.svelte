<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		BACKUP_MAX_BYTES,
		backupDate,
		backupGroups,
		backupActions,
		type BackupPreview
	} from '$lib/backup-preview';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let mounted = $state(false),
		file = $state<File | null>(null),
		body = $state(''),
		preview = $state<BackupPreview | null>(null);
	let checking = $state(false),
		restoring = $state(false),
		refreshing = $state(false),
		confirmed = $state(false),
		completed = $state(false),
		uncertain = $state(false);
	let listError = $state<string | null>(null);
	let listedBackups = $state<typeof data.backups | null>(null);
	let backups = $derived(listedBackups ?? data.backups);
	let backupError = $derived(listError ?? data.backupError);
	let message = $state(''),
		errors = $state<string[]>([]),
		group = $state('all'),
		action = $state('changed'),
		query = $state(''),
		page = $state(1);
	let busy = $derived(checking || restoring);
	let filtered = $derived(
		(preview?.changes ?? []).filter(
			(row) =>
				(group === 'all' || row.group === group) &&
				(action === 'all' ||
					(action === 'changed' && ['added', 'updated', 'removed'].includes(row.action)) ||
					row.action === action) &&
				`${row.name} ${row.key} ${row.fields.join(' ')}`
					.toLowerCase()
					.includes(query.trim().toLowerCase())
		)
	);
	let pages = $derived(Math.max(1, Math.ceil(filtered.length / 20)));
	let visible = $derived(
		filtered.slice((Math.min(page, pages) - 1) * 20, Math.min(page, pages) * 20)
	);
	onMount(() => {
		mounted = true;
	});
	beforeNavigate(({ cancel }) => {
		if (busy) cancel();
	});
	function size(bytes: number | null) {
		return bytes === null
			? '大小未知'
			: bytes >= 1024 * 1024
				? `${(bytes / 1024 / 1024).toFixed(2)} MiB`
				: `${Math.max(1, Math.round(bytes / 1024))} KiB`;
	}
	function choose(event: Event) {
		file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
		preview = null;
		body = '';
		confirmed = false;
		completed = false;
		uncertain = false;
		message = '';
		errors = [];
	}
	async function backupRequest(
		path: '/api/admin/backup/preview' | '/api/admin/backup/restore',
		headers: Record<string, string> = {}
	) {
		const controller = new AbortController(),
			timer = setTimeout(() => controller.abort(), 45000);
		try {
			const response = await fetch(resolve(path), {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...headers },
				body,
				signal: controller.signal
			});
			return { response, value: await response.json() };
		} finally {
			clearTimeout(timer);
		}
	}
	async function check() {
		if (!file || busy) return;
		checking = true;
		preview = null;
		confirmed = false;
		completed = false;
		message = '正在检查文件与站点数据…';
		errors = [];
		try {
			if (file.size > BACKUP_MAX_BYTES) throw new Error('备份不能超过 2 MiB。');
			body = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
			const { response, value } = await backupRequest('/api/admin/backup/preview');
			if (!response.ok) {
				errors = Array.isArray(value.details) ? value.details : [];
				throw new Error(value.error ?? '检查失败，请稍后重试。');
			}
			if (
				!value.preview ||
				!Array.isArray(value.preview.groups) ||
				!Array.isArray(value.preview.changes) ||
				!value.preview.backupDigest ||
				!value.preview.stateDigest
			)
				throw new Error('未收到完整预览，请重新检查。');
			preview = value.preview;
			uncertain = false;
			group = 'all';
			action = 'changed';
			query = '';
			page = 1;
			message = preview?.hasChanges
				? '检查通过。请核对下方变更后确认恢复。'
				: '检查通过：站点与备份内容一致，无需恢复。';
		} catch (error) {
			message =
				error instanceof TypeError || error instanceof DOMException
					? '网络或文件读取异常，检查未完成，所选文件已保留，请重试。'
					: error instanceof SyntaxError
						? '检查响应无效，请重新检查。'
						: error instanceof Error
							? error.message
							: '检查失败，请重试。';
		} finally {
			checking = false;
		}
	}
	async function restore() {
		if (!preview || !confirmed || !preview.hasChanges || busy || completed || uncertain) return;
		restoring = true;
		message = '正在恢复，请停留在此页面等待结果…';
		errors = [];
		try {
			const { response, value } = await backupRequest('/api/admin/backup/restore', {
				'x-backup-digest': preview.backupDigest,
				'x-backup-state': preview.stateDigest,
				'x-backup-confirmed': 'yes'
			});
			if (!response.ok) {
				if (value.uncertain) uncertain = true;
				else preview = null;
				confirmed = false;
				errors = Array.isArray(value.details) ? value.details : [];
				message = value.error ?? '未能确认恢复结果，请重新检查。';
				return;
			}
			if (
				value.success !== true ||
				!value.restored ||
				!Number.isSafeInteger(value.restored.changed)
			)
				throw new Error('恢复响应不完整。');
			completed = true;
			confirmed = false;
			message = `恢复已确认完成：备份中的 ${value.restored.categories} 个分类、${value.restored.tags} 个标签、${value.restored.items} 条内容已处理，共 ${value.restored.changed} 个变更项目。`;
			if (!(await refresh(true))) message += ' 列表刷新失败，可稍后重试。';
		} catch {
			uncertain = true;
			confirmed = false;
			message = '恢复结果未确认。请先重新检查同一文件并核对变更，不要直接重复恢复。';
		} finally {
			restoring = false;
		}
	}
	async function refresh(force = false) {
		if (refreshing || (busy && !force)) return false;
		refreshing = true;
		const controller = new AbortController(),
			timer = setTimeout(() => controller.abort(), 15000);
		try {
			const response = await fetch(resolve('/api/admin/backup/scheduled'), {
				signal: controller.signal
			});
			const value = await response.json();
			if (!response.ok) throw new Error(value.error ?? '列表刷新失败，请稍后重试。');
			if (!Array.isArray(value.data)) throw new Error('备份列表响应不完整，请重新刷新。');
			listedBackups = value.data;
			listError = '';
			return true;
		} catch (error) {
			listError =
				error instanceof TypeError || error instanceof DOMException
					? '列表刷新失败，请稍后重试。'
					: error instanceof Error
						? error.message
						: '列表刷新失败，请稍后重试。';
			return false;
		} finally {
			clearTimeout(timer);
			refreshing = false;
		}
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">BACKUP</p>
		<h1>导入导出</h1>
		<p class="backup-muted">先核对变更，再恢复站点内容与配置。</p>
	</div>
	<a
		class="admin-primary-button"
		href={resolve('/api/admin/backup')}
		aria-disabled={busy || undefined}
		onclick={(e) => {
			if (busy) e.preventDefault();
		}}>下载当前 JSON 备份</a
	>
</header>
<section class="admin-editor backup-scope">
	<div class="admin-editor-header"><h2>恢复范围</h2></div>
	<div class="detail-content">
		<p>
			<strong>合并内容：</strong>分类、标签和内容按“类型 + 地址标识”新增或更新，备份外的记录保留。
		</p>
		<p>
			<strong>替换配置：</strong
			>有变化的首页模块、搜索源、热榜源和站点配置组按备份整体替换，备份外的配置会移除。热榜源组被替换后，缓存需重新获取。
		</p>
		<p>
			备份不包含用户、密码、登录会话、私人收藏与足迹、投稿消息、统计、文件索引及图片文件。已有内容的作者、图标和封面关联保留；迁移到新站时不会带入原图片。
		</p>
	</div>
</section>
<section class="admin-editor backup-library" aria-label="任务备份">
	<div class="admin-editor-header">
		<div>
			<h2>任务备份</h2>
			<p class="backup-muted">自动与手动备份各保留最新 {data.retention} 份，时间统一为北京时间。</p>
		</div>
		{#if mounted}<button
				class="admin-secondary-button"
				type="button"
				disabled={busy || refreshing}
				onclick={() => refresh()}>{refreshing ? '刷新中…' : '刷新列表'}</button
			>{/if}
	</div>
	<div class="detail-content">
		<p>
			自动备份计划每天 03:00 运行；手动备份可在<a href={resolve('/admin/cron-runs')}>定时任务</a
			>中补跑，独立保存。
		</p>
		{#if backupError}<p class="backup-notice" role="status">
				{backupError}
			</p>{:else if !backups.length}<p class="backup-muted">
				暂无任务备份，可先下载当前 JSON 备份。
			</p>{:else}
			<ul class="backup-list">
				{#each backups as backup (backup.key)}<li>
						<div class="backup-file">
							<span class="backup-kind"
								>{backup.key.startsWith('manual-backups/') ? '手动备份' : '自动备份'}</span
							><strong>{backup.key.split('/').pop()}</strong><span class="backup-muted"
								>{backupDate(backup.uploadedAt)} · {size(backup.size)}</span
							>
						</div>
						<a
							class="admin-secondary-button"
							href={resolve(
								`/api/admin/backup/scheduled?key=${encodeURIComponent(backup.key)}` as '/api/admin/backup/scheduled'
							)}>下载备份</a
						>
					</li>{/each}
			</ul>
		{/if}
	</div>
</section>
<section class="admin-editor restore-workspace" aria-label="恢复备份">
	<div class="admin-editor-header">
		<div>
			<h2>检查并恢复备份</h2>
			<p class="backup-muted">1 选择文件 → 2 检查变更 → 3 确认恢复</p>
		</div>
	</div>
	<noscript
		><p class="backup-notice">
			请启用 JavaScript 后检查和恢复备份。上方备份下载仍可使用。
		</p></noscript
	>
	{#if mounted}<div class="admin-form">
			<label
				><span>选择 NaviNest JSON 备份（最大 2 MiB）</span><input
					type="file"
					accept="application/json,.json"
					disabled={busy}
					onchange={choose}
				/></label
			>
			{#if file}<p class="backup-muted">
					已选：{file.name} · {size(file.size)}，版本 1 格式。
				</p>{/if}
			<div class="admin-form-actions">
				<button class="admin-primary-button" type="button" disabled={!file || busy} onclick={check}
					>{checking ? '检查中…' : uncertain ? '重新检查并核对' : '检查并预览'}</button
				>
			</div>
			{#if message}<div
					class="backup-notice"
					class:uncertain
					class:completed
					role={errors.length ? 'alert' : 'status'}
				>
					<p>{message}</p>
					{#if errors.length}<ul>
							{#each errors as error, index (`${index}:${error}`)}<li>{error}</li>{/each}
						</ul>{/if}
				</div>{/if}
		</div>{/if}
	{#if preview}<div class="restore-preview" aria-label="恢复预览">
			<h3>变更预览</h3>
			<p class="backup-muted">
				备份生成时间：{backupDate(preview.generatedAt)}（北京时间）。{completed
					? '本次预览已完成恢复。'
					: uncertain
						? '恢复结果待核对，请重新检查。'
						: '预览只检查数据，尚未执行恢复。'}
			</p>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll this labelled table region.) -->
			<div
				class="restore-summary"
				role="region"
				tabindex="0"
				aria-label="恢复范围与数量，可横向滚动"
			>
				<table>
					<thead
						><tr
							><th>范围</th><th>方式</th><th>现有 / 备份</th><th>新增</th><th>更新</th><th>移除</th
							><th>不变</th><th>保留</th></tr
						></thead
					><tbody
						>{#each preview.groups as entry (entry.key)}<tr
								><th>{backupGroups[entry.key]}</th><td
									>{entry.mode === 'merge' ? '合并' : '整组替换'}</td
								><td>{entry.current} / {entry.incoming}</td><td>{entry.counts.added}</td><td
									>{entry.counts.updated}</td
								><td>{entry.counts.removed}</td><td>{entry.counts.unchanged}</td><td
									>{entry.counts.preserved}</td
								></tr
							>{/each}</tbody
					>
				</table>
			</div>
			<p class="backup-muted">
				“不变”指字段内容一致；配置组有变化时会整体重建该组，“保留”仅适用于备份外的分类、标签和内容。
			</p>
			<form
				class="preview-filters"
				onsubmit={(e) => {
					e.preventDefault();
					page = 1;
				}}
			>
				<label
					>范围<select bind:value={group} onchange={() => (page = 1)} disabled={busy}
						><option value="all">全部范围</option
						>{#each Object.entries(backupGroups) as [value, label] (value)}<option {value}
								>{label}</option
							>{/each}</select
					></label
				><label
					>变更类型<select bind:value={action} onchange={() => (page = 1)} disabled={busy}
						><option value="changed">仅查看变更</option><option value="all">全部项目</option
						>{#each Object.entries(backupActions) as [value, label] (value)}<option {value}
								>{label}</option
							>{/each}</select
					></label
				><label
					>查找项目<input
						type="search"
						bind:value={query}
						oninput={() => (page = 1)}
						disabled={busy}
						placeholder="名称、标识或字段"
					/></label
				><button class="admin-secondary-button" type="submit" disabled={busy}>查找</button>
			</form>
			<p class="backup-muted">
				共 {filtered.length} 个项目 · 第 {Math.min(page, pages)} / {pages} 页
			</p>
			<ul class="backup-change-list">
				{#each visible as change (`${change.group}:${change.key}`)}<li>
						<div>
							<strong>{change.name}</strong><span class="change-action"
								>{backupActions[change.action]}</span
							>
						</div>
						<p>{backupGroups[change.group]} · {change.key}</p>
						{#if change.fields.length}<p>变化字段：{change.fields.join('、')}</p>{/if}
					</li>{:else}<li>当前筛选没有匹配项目。</li>{/each}
			</ul>
			{#if pages > 1}<nav class="preview-pages" aria-label="预览分页">
					<button
						class="admin-secondary-button"
						type="button"
						disabled={page <= 1 || busy}
						onclick={() => page--}>上一页</button
					><span>{Math.min(page, pages)} / {pages}</span><button
						class="admin-secondary-button"
						type="button"
						disabled={page >= pages || busy}
						onclick={() => page++}>下一页</button
					>
				</nav>{/if}
			{#if preview.hasChanges}<div class="restore-confirm">
					<label
						><input
							type="checkbox"
							bind:checked={confirmed}
							disabled={busy || completed || uncertain}
						/><span>我已核对上述变更，确认合并内容并替换有变化的配置组。</span></label
					><button
						class="admin-primary-button"
						type="button"
						disabled={!confirmed || busy || completed || uncertain}
						onclick={restore}
						>{restoring ? '正在恢复…' : completed ? '本次恢复已完成' : '确认恢复'}</button
					>
				</div>{/if}
		</div>{/if}
</section>

<style>
	.backup-muted {
		margin: 6px 0;
		color: var(--admin-muted);
		font-size: 13px;
		line-height: 1.8;
		overflow-wrap: anywhere;
	}
	.backup-scope .detail-content p,
	.backup-library .detail-content p {
		line-height: 1.8;
	}
	.backup-library .detail-content a {
		color: var(--admin-accent);
		text-decoration: underline;
	}
	.admin-editor-header {
		flex-wrap: wrap;
		gap: 12px;
	}
	.admin-editor-header h2 {
		margin: 0;
	}
	.backup-list {
		list-style: none;
		margin: 18px 0 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}
	.backup-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		border: 1px solid var(--admin-line);
		border-radius: 10px;
		padding: 16px;
		background: var(--admin-soft);
	}
	.backup-file {
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.backup-file strong {
		font-size: 15px;
		overflow-wrap: anywhere;
	}
	.backup-kind {
		font-size: 13px;
		color: var(--admin-text);
	}
	.backup-list a {
		flex: none;
	}
	.backup-notice {
		padding: 14px 16px;
		border: 1px solid var(--admin-line);
		border-radius: 10px;
		background: var(--admin-soft);
		color: var(--admin-text);
		line-height: 1.8;
		font-size: 15px;
		overflow-wrap: anywhere;
	}
	.backup-notice p {
		margin: 0;
	}
	.backup-notice.uncertain {
		border-color: var(--admin-accent);
	}
	.backup-notice ul {
		padding-left: 20px;
	}
	.restore-workspace .admin-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 12px;
	}
	.restore-workspace input[type='file'] {
		width: 100%;
		min-width: 0;
		min-height: 44px;
	}
	.restore-workspace .admin-form-actions {
		margin: 0;
	}
	.restore-preview {
		scroll-margin-top: 90px;
		padding: 0 24px 24px;
		min-width: 0;
	}
	.restore-preview h3 {
		font-size: 18px;
	}
	.restore-summary {
		max-width: 100%;
		overflow: auto;
		border: 1px solid var(--admin-line);
		border-radius: 10px;
		margin-top: 16px;
	}
	.restore-summary table {
		width: 100%;
		min-width: 740px;
		border-collapse: collapse;
		font-size: 13px;
	}
	.restore-summary th,
	.restore-summary td {
		padding: 12px;
		text-align: left;
		white-space: nowrap;
		border-bottom: 1px solid var(--admin-line);
	}
	.restore-summary tr > :first-child {
		position: sticky;
		left: 0;
		z-index: 1;
		background: var(--admin-surface);
	}
	.restore-summary thead tr > :first-child {
		background: var(--admin-soft);
	}
	.restore-summary thead {
		background: var(--admin-soft);
	}
	.preview-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: end;
		margin: 24px 0 12px;
	}
	.preview-filters label {
		display: grid;
		gap: 8px;
		flex: 1 1 160px;
		min-width: 0;
		font-size: 13px;
	}
	.preview-filters input,
	.preview-filters select {
		font: inherit;
		min-height: 44px;
		width: 100%;
		min-width: 0;
		padding: 10px;
		border: 1px solid var(--admin-line);
		border-radius: 8px;
		background: var(--admin-soft);
		color: var(--admin-text);
	}
	.backup-change-list {
		list-style: none;
		padding: 0;
		margin: 12px 0;
		display: grid;
		gap: 10px;
	}
	.backup-change-list li {
		padding: 14px;
		border: 1px solid var(--admin-line);
		border-radius: 10px;
		background: var(--admin-soft);
		overflow-wrap: anywhere;
		font-size: 15px;
	}
	.backup-change-list li > div {
		display: flex;
		flex-wrap: wrap;
		align-items: start;
		justify-content: space-between;
		gap: 10px;
	}
	.backup-change-list p {
		font-size: 13px;
		line-height: 1.8;
		color: var(--admin-muted);
		margin: 8px 0 0;
	}
	.change-action {
		font-size: 13px;
		color: var(--admin-text);
	}
	.preview-pages {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		margin: 18px 0;
		font-size: 13px;
	}
	.restore-confirm {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: center;
		margin-top: 24px;
		padding-top: 18px;
		border-top: 1px solid var(--admin-line);
	}
	.restore-confirm label {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 1 1 300px;
		min-height: 44px;
		font-size: 15px;
		line-height: 1.8;
	}
	.restore-confirm input {
		width: 20px;
		height: 20px;
		flex: none;
	}
	.restore-workspace button,
	.backup-library button,
	.backup-list a {
		min-height: 44px;
	}
	@media (max-width: 600px) {
		.backup-list li {
			align-items: stretch;
			flex-direction: column;
		}
		.backup-list a {
			align-self: start;
		}
		.restore-preview {
			padding: 0 16px 20px;
		}
		.preview-filters label {
			flex-basis: 100%;
		}
		.restore-confirm button {
			width: 100%;
		}
	}
</style>
