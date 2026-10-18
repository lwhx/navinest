export const adminNavigation = [
	{ label: '工作台', items: [{ href: '/admin', label: '工作台', icon: 'grid' }] },
	{
		label: '内容运营',
		items: [
			{ href: '/admin/items', label: '内容管理', icon: 'document' },
			{ href: '/admin/link-checks', label: '网址检查', icon: 'check' },
			{ href: '/admin/categories', label: '分类管理', icon: 'folder' },
			{ href: '/admin/tags', label: '标签管理', icon: 'tag' },
			{ href: '/admin/submissions', label: '投稿审核', icon: 'check' },
			{ href: '/admin/files', label: '文件资源', icon: 'image' }
		]
	},
	{
		label: '站点呈现',
		items: [
			{ href: '/admin/home-modules', label: '首页模块', icon: 'layout' },
			{ href: '/admin/search-engines', label: '搜索源', icon: 'search' },
			{ href: '/admin/hot-sources', label: '热榜源', icon: 'trend' },
			{ href: '/admin/settings', label: '站点设置', icon: 'settings' }
		]
	},
	{
		label: '用户与系统',
		items: [
			{ href: '/admin/users', label: '用户管理', icon: 'users' },
			{ href: '/admin/messages', label: '站内消息', icon: 'message' },
			{ href: '/admin/ai-providers', label: 'AI 服务', icon: 'spark' },
			{ href: '/admin/cron-runs', label: '定时任务', icon: 'clock' },
			{ href: '/admin/import-export', label: '备份与导入', icon: 'archive' }
		]
	}
] as const;

export function adminLocation(path: string) {
	for (const group of adminNavigation) {
		const item = group.items.find(
			(entry) =>
				path === entry.href || (entry.href !== '/admin' && path.startsWith(entry.href + '/'))
		);
		if (item) return { group: group.label, ...item };
	}
	return { group: '管理后台', href: '/admin', label: '管理后台', icon: 'grid' };
}
