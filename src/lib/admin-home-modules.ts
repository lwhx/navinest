export const homeModuleLabels: Record<string, { label: string; description: string }> = {
	search: { label: '搜索', description: '提供搜索入口和推荐搜索词。' },
	content: { label: '分类资源', description: '展示所选分类的资源，分类需启用并有公开内容。' },
	ranking: { label: '排行榜', description: '展示资源排行；同类启用模块只展示排序最靠前的一项。' },
	hot: { label: '今日热点', description: '展示今日热点；同类启用模块只展示排序最靠前的一项。' },
	links: { label: '快捷链接', description: '展示配置中的快捷链接，最多显示 12 个。' },
	custom_html: { label: '自定义区块', description: '该模块目前不会显示在首页，已有配置会保留。' }
};
