export type NavigationCategory = {
	id?: number;
	parentId?: number | null;
	name: string;
	slug: string;
	icon: string;
};

export type NavigationItem = {
	type: ContentType;
	slug: string;
	title: string;
	url: string | null;
	category: string;
	summary: string;
	tags: Array<{ name: string; slug: string }>;
	accent: string;
	iconFileId?: number | null;
	coverFileId?: number | null;
};

export type SearchEngine = {
	name: string;
	key: string;
	urlTemplate: string;
};

export const categories: NavigationCategory[] = [
	{ name: '常用推荐', slug: 'favorites', icon: 'star' },
	{ name: '开发工具', slug: 'dev-tools', icon: 'code' },
	{ name: '设计资源', slug: 'design', icon: 'palette' },
	{ name: '效率工具', slug: 'productivity', icon: 'app' },
	{ name: '书籍影视', slug: 'bookshelf', icon: 'book' },
	{ name: '文章摘录', slug: 'notes', icon: 'file' },
	{ name: '站点公告', slug: 'announcements', icon: 'bell' }
];

export const navigationItems: NavigationItem[] = [
	{
		type: 'site',
		slug: 'cloudflare-dashboard',
		title: 'Cloudflare Dashboard',
		url: 'https://dash.cloudflare.com',
		category: '常用推荐',
		summary: '管理 Workers、D1、R2 和域名配置。',
		tags: [
			{ name: 'Cloudflare', slug: 'cloudflare' },
			{ name: 'Deploy', slug: 'deploy' }
		],
		accent: '#ef6f4d'
	},
	{
		type: 'site',
		slug: 'github',
		title: 'GitHub',
		url: 'https://github.com',
		category: '开发工具',
		summary: '代码托管、Issues 和 Actions 工作流。',
		tags: [
			{ name: 'Code', slug: 'code' },
			{ name: 'CI', slug: 'ci' }
		],
		accent: '#2f6fed'
	},
	{
		type: 'site',
		slug: 'svelte',
		title: 'Svelte',
		url: 'https://svelte.dev',
		category: '开发工具',
		summary: '构建 NaviNest 前端体验的核心框架。',
		tags: [
			{ name: 'SvelteKit', slug: 'sveltekit' },
			{ name: 'UI', slug: 'ui' }
		],
		accent: '#ff3e00'
	},
	{
		type: 'site',
		slug: 'figma',
		title: 'Figma',
		url: 'https://figma.com',
		category: '设计资源',
		summary: '界面设计、原型和视觉资产协作。',
		tags: [
			{ name: 'Design', slug: 'design' },
			{ name: 'Prototype', slug: 'prototype' }
		],
		accent: '#9b6bff'
	},
	{
		type: 'app',
		slug: 'visual-studio-code',
		title: 'Visual Studio Code',
		url: 'https://code.visualstudio.com',
		category: '效率工具',
		summary: '轻量但强大的代码编辑器。',
		tags: [
			{ name: 'Editor', slug: 'editor' },
			{ name: 'Tools', slug: 'tools' }
		],
		accent: '#1f9cf0'
	},
	{
		type: 'book',
		slug: 'design-of-everyday-things',
		title: 'The Design of Everyday Things',
		url: 'https://en.wikipedia.org/wiki/The_Design_of_Everyday_Things',
		category: '书籍影视',
		summary: '关于可用性和产品设计的经典读物。',
		tags: [
			{ name: 'Reading', slug: 'reading' },
			{ name: 'Design', slug: 'design' }
		],
		accent: '#2ca66f'
	},
	{
		type: 'post',
		slug: 'building-a-quiet-start-space',
		title: '构建一个安静的起点',
		url: null,
		category: '文章摘录',
		summary: '记录 NaviNest 在信息密度、导航效率和视觉克制之间的设计取舍。',
		tags: [{ name: 'Notes', slug: 'notes' }],
		accent: '#397a9b'
	},
	{
		type: 'bulletin',
		slug: 'navinest-preview',
		title: 'NaviNest 预览版上线',
		url: null,
		category: '站点公告',
		summary: '导航首页、搜索、分类、标签、详情与安全跳转现已可用。',
		tags: [{ name: 'Update', slug: 'update' }],
		accent: '#b27635'
	}
];

export const searchEngines: SearchEngine[] = [
	{ name: '站内', key: 'site', urlTemplate: '/search?q={query}' },
	{ name: 'Google', key: 'google', urlTemplate: 'https://www.google.com/search?q={query}' },
	{ name: 'Bing', key: 'bing', urlTemplate: 'https://www.bing.com/search?q={query}' },
	{ name: 'GitHub', key: 'github', urlTemplate: 'https://github.com/search?q={query}' }
];
import type { ContentType } from '$lib/types/content';
