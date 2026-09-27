<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let file = $state<File | null>(null),
		message = $state(''),
		restoring = $state(false);
	function size(bytes: number | null) {
		if (bytes === null) return '大小未知';
		return bytes >= 1024 * 1024
			? `${(bytes / 1024 / 1024).toFixed(2)} MiB`
			: `${Math.max(1, Math.round(bytes / 1024))} KiB`;
	}
	async function restore() {
		if (!file || restoring) return;
		if (
			!confirm(
				'恢复会按自然键更新或新增分类、标签、内容和站点配置。用户、认证和私人数据不会改变。确定继续吗？'
			)
		)
			return;
		restoring = true;
		message = '正在验证并恢复…';
		const r = await fetch('/api/admin/backup/restore', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: await file.text()
		});
		const data = await r.json();
		restoring = false;
		message = r.ok
			? `恢复成功：${data.restored.categories} 个分类、${data.restored.tags} 个标签、${data.restored.items} 条内容。`
			: (data.details?.join('；') ?? data.error);
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Backup</p>
		<h1>导入导出</h1>
	</div>
	<a class="admin-primary-button" href={resolve('/api/admin/backup')}>下载 JSON 备份</a>
</header>
<section class="admin-editor">
	<div class="admin-editor-header"><h2>备份范围</h2></div>
	<div class="detail-content">
		<p>备份包含分类、标签、内容、内容关系、首页模块、搜索源、热榜源和站点设置。</p>
		<p>
			不包含用户、密码、OAuth、Session、私人收藏/足迹/导航、投稿消息、统计、文件索引和 R2 对象。
		</p>
	</div>
</section>
<section class="admin-editor">
	<div class="admin-editor-header"><h2>定时备份</h2></div>
	<div class="detail-content">
		<p>
			每天 03:00（北京时间）自动把站点快照写入 R2（<code>FILES</code> 绑定的
			<code>backups/</code> 前缀下），仅保留最新 {data.retention} 份；超过保留份数的旧备份会被自动删除。
		</p>
		{#if !data.backups.length}
			<p>
				暂无定时备份。首次定时任务执行后，或在 <code>wrangler</code> 配置第二个 cron 触发后即可看到。
			</p>
		{:else}
			<ul class="backup-list">
				{#each data.backups as backup (backup.key)}
					<li>
						<a
							href={resolve(
								`/api/admin/backup/scheduled?key=${encodeURIComponent(backup.key)}` as '/api/admin/backup/scheduled'
							)}>{backup.key.split('/').pop()}</a
						>
						<small
							>{size(backup.size)} · {backup.uploadedAt
								? new Date(backup.uploadedAt).toLocaleString('zh-CN')
								: '时间未知'}</small
						>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>
<section class="admin-editor">
	<div class="admin-editor-header"><h2>恢复 JSON 备份</h2></div>
	{#if message}<p class="admin-form-message" role="status">{message}</p>{/if}
	<div class="admin-form">
		<label
			><span>选择 NaviNest 备份文件（最大 2 MiB）</span><input
				type="file"
				accept="application/json,.json"
				onchange={(e) => (file = e.currentTarget.files?.[0] ?? null)}
			/></label
		>
		<div class="admin-form-actions">
			<button
				class="admin-primary-button"
				type="button"
				disabled={!file || restoring}
				onclick={restore}>验证并恢复</button
			><a class="admin-secondary-button" href={resolve('/admin')}>返回后台</a>
		</div>
	</div>
</section>

<style>
	.backup-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.backup-list li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 0;
		border-bottom: 1px solid #e4e7eb;
	}

	.backup-list a {
		color: #2563eb;
		text-decoration: none;
	}

	.backup-list small {
		color: #6b7078;
	}
</style>
