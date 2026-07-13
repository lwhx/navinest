<script lang="ts">
	import { resolve } from '$app/paths';
	let file = $state<File | null>(null),
		message = $state(''),
		restoring = $state(false);
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
