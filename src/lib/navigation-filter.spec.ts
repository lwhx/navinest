import { describe, expect, it } from 'vitest';
import { filterLinks, linkHost } from '$lib/navigation-filter';

const links = [
	{
		id: 1,
		title: 'GitHub',
		url: 'https://github.com/lwhx',
		summary: '代码托管',
		categoryName: '工作'
	},
	{
		id: 2,
		title: '设计灵感',
		url: 'https://www.behance.net',
		summary: null,
		categoryName: '收藏'
	},
	{
		id: 3,
		title: '内部看板',
		url: 'https://intra.example.com/board',
		summary: '仅内网',
		categoryName: '工作'
	}
];

describe('custom link filtering', () => {
	it('returns the original list for empty or whitespace queries', () => {
		expect(filterLinks(links, '')).toBe(links);
		expect(filterLinks(links, '   ')).toBe(links);
	});

	it('matches titles, URLs, hosts and summaries case-insensitively', () => {
		expect(filterLinks(links, 'github').map((link) => link.id)).toEqual([1]);
		expect(filterLinks(links, 'BEHANCE.NET').map((link) => link.id)).toEqual([2]);
		expect(filterLinks(links, ' 设计 ').map((link) => link.id)).toEqual([2]);
		expect(filterLinks(links, '/board').map((link) => link.id)).toEqual([3]);
		expect(filterLinks(links, '仅内网').map((link) => link.id)).toEqual([3]);
	});

	it('filters by category name and keeps the original order', () => {
		expect(filterLinks(links, '工作').map((link) => link.id)).toEqual([1, 3]);
		expect(filterLinks(links, '不存在的关键字')).toEqual([]);
	});

	it('derives a host for display and tolerates broken URLs', () => {
		expect(linkHost('https://example.com/a/b')).toBe('example.com');
		expect(linkHost('not a url')).toBe('not a url');
	});
});
