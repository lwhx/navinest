<script lang="ts">
	import { resolve } from '$app/paths';
	import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const metrics = $derived([
		{
			label: '内容总数',
			value: data.items,
			detail: `${data.summary.published} 条已发布`,
			href: '/admin/items',
			icon: 'document'
		},
		{
			label: '待审核投稿',
			value: data.submissions,
			detail: '查看投稿并决定是否收录',
			href: '/admin/submissions',
			icon: 'check'
		},
		{
			label: '草稿',
			value: data.summary.draft,
			detail: '继续完善未发布的内容',
			href: '/admin/items?status=draft',
			icon: 'folder'
		},
		{
			label: '分类',
			value: data.categories,
			detail: `${data.tags} 个标签 · ${data.users} 位用户`,
			href: '/admin/categories',
			icon: 'tag'
		}
	]);
	const entries = [
		{
			title: '新增内容',
			note: '收录网址、资源或文章',
			href: '/admin/items?create=1',
			icon: 'document'
		},
		{
			title: '调整首页',
			note: '整理模块、分类与展示顺序',
			href: '/admin/home-modules',
			icon: 'layout'
		},
		{ title: '管理分类', note: '整理层级与资源归属', href: '/admin/categories', icon: 'folder' },
		{
			title: '备份与导入',
			note: '导出数据或导入已有资源',
			href: '/admin/import-export',
			icon: 'archive'
		}
	];
	const runStatus: Record<string, string> = {
		success: '执行成功',
		failed: '执行失败',
		partial: '部分失败',
		running: '执行中'
	};
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">工作台</p>
		<h1>今天，从这里开始</h1>
		<p class="admin-page-description">先处理待办，再整理内容和首页。</p>
	</div>
	<a class="admin-primary-button" href={resolve('/admin/items?create=1')}>新增内容</a>
</header>
{#if data.source === 'fallback'}<p class="admin-notice">
		当前为本地只读预览，连接数据库后显示真实待办和最近更新。
	</p>{/if}
<section class="admin-dashboard-metrics" aria-label="数据概览">
	{#each metrics as metric (metric.label)}<a href={resolve(metric.href as '/')}
			><span class="admin-metric-label"><AdminIcon name={metric.icon} />{metric.label}</span><strong
				>{metric.value}</strong
			><small>{metric.detail}</small></a
		>{/each}
</section>
<div class="admin-dashboard-grid">
	<section class="admin-panel" aria-labelledby="admin-tasks-title">
		<div class="admin-panel-heading">
			<h2 id="admin-tasks-title">需要处理</h2>
			<span>按事项进入管理页面</span>
		</div>
		<div class="admin-task-list">
			<a href={resolve('/admin/submissions')}
				><span
					><strong>投稿审核</strong><small
						>{data.submissions ? '有新的投稿等待审核与收录。' : '目前没有待审核投稿。'}</small
					></span
				><b class:attention={data.submissions > 0}>{data.submissions} 条</b></a
			>
			<a href={resolve('/admin/items?status=draft')}
				><span><strong>继续编辑草稿</strong><small>完善标题、用途与分类后再发布。</small></span><b
					>{data.summary.draft} 条</b
				></a
			>
			<a href={resolve('/admin/hot-sources')}
				><span
					><strong>热榜源状态</strong><small
						>{data.health.hotErrors === null
							? '暂时无法读取状态，请进入热榜源核对。'
							: data.health.hotErrors
								? '部分启用的热榜源最近刷新失败。'
								: '启用的热榜源没有记录刷新错误。'}</small
					></span
				><b class:attention={(data.health.hotErrors ?? 0) > 0}
					>{data.health.hotErrors === null ? '待核对' : `${data.health.hotErrors} 个异常`}</b
				></a
			>
		</div>
	</section>
	<section class="admin-panel" aria-labelledby="admin-shortcuts-title">
		<div class="admin-panel-heading"><h2 id="admin-shortcuts-title">常用操作</h2></div>
		<div class="admin-shortcut-grid">
			{#each entries as entry (entry.title)}<a href={resolve(entry.href as '/')}
					><AdminIcon name={entry.icon} /><strong>{entry.title}</strong><small>{entry.note}</small
					></a
				>{/each}
		</div>
	</section>
	<section class="admin-panel" aria-labelledby="admin-recent-title">
		<div class="admin-panel-heading">
			<h2 id="admin-recent-title">最近更新</h2>
			<a href={resolve('/admin/items')}>查看全部</a>
		</div>
		<div class="admin-recent-list">
			{#each data.recent as item (item.id)}<a href={resolve(`/admin/items?edit=${item.id}`)}
					><span
						><strong>{item.title}</strong><small
							>{item.status === 'published' ? '已发布' : '草稿'} · {item.visibility === 'public'
								? '公开'
								: '私有'}</small
						></span
					><time datetime={item.updatedAt}>{item.updatedAt.slice(0, 10)}</time></a
				>{:else}<p class="admin-panel-empty">还没有最近更新的内容，从“新增内容”开始收录。</p>{/each}
		</div>
	</section>
	<section class="admin-panel" aria-labelledby="admin-system-title">
		<div class="admin-panel-heading"><h2 id="admin-system-title">站点维护</h2></div>
		<div class="admin-system-summary">
			<span
				class="admin-state-dot"
				class:attention={data.health.lastRun &&
					['failed', 'partial'].includes(data.health.lastRun.status)}
			></span>
			<div>
				<strong
					>{data.health.lastRun
						? (runStatus[data.health.lastRun.status] ?? '待核对执行状态')
						: data.health.cronAvailable
							? '暂无任务执行记录'
							: '任务状态待核对'}</strong
				>
				<p>
					{data.health.lastRun
						? `最近执行于 ${data.health.lastRun.started_at}（UTC）`
						: '查看任务记录，确认热榜刷新与定时备份。'}
				</p>
			</div>
		</div>
		<div class="admin-maintenance-links">
			<a href={resolve('/admin/cron-runs')}>查看定时任务</a><a
				href={resolve('/admin/import-export')}>检查备份</a
			><a href={resolve('/admin/settings')}>站点设置</a>
		</div>
	</section>
</div>
