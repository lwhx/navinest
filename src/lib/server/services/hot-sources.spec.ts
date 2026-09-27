import { describe, expect, it } from 'vitest';
import { validateHotSourceInput } from '$lib/server/services/hot-sources';

describe('hot source validation', () => {
	it('normalizes a safe JSON source', () => {
		expect(
			validateHotSourceInput({
				name: ' Demo ',
				type: 'json',
				url: 'https://example.com/hot.json',
				headersJson: '{"Accept":"application/json"}',
				parserJson: '{"itemsPath":"data.items","titleField":"title","urlField":"url"}',
				cacheTtl: '900',
				isEnabled: 'on'
			})
		).toEqual({
			valid: true,
			data: {
				name: 'Demo',
				type: 'json',
				url: 'https://example.com/hot.json',
				headers: { Accept: 'application/json' },
				parser: { itemsPath: 'data.items', titleField: 'title', urlField: 'url' },
				cacheTtl: 900,
				isEnabled: true,
				slug: 'demo',
				description: '',
				icon: '热',
				accentColor: '#e5484d',
				surfaceColor: '#fff7f7',
				displayLimit: 20,
				layout: 'list',
				sortOrder: 0,
				showDescription: false
			}
		});
	});
	it('rejects private targets, credential headers and invalid parser fields', () => {
		expect(
			validateHotSourceInput({
				name: 'Bad',
				type: 'json',
				url: 'http://127.0.0.1/feed',
				headersJson: '{"Authorization":"secret"}',
				parserJson: '{"itemsPath":[]}',
				cacheTtl: '1'
			})
		).toMatchObject({
			valid: false,
			errors: {
				url: expect.any(String),
				headersJson: expect.any(String),
				parserJson: expect.any(String),
				cacheTtl: expect.any(String)
			}
		});
	});
	it('normalizes a highly customizable RSSHub board', () => {
		expect(
			validateHotSourceInput({
				name: '百度热点',
				slug: 'baidu-hot',
				type: 'rss',
				url: 'https://rsshub.example.com/baidu/top',
				description: '百度实时热点榜',
				icon: '百',
				accentColor: '#E5484D',
				surfaceColor: '#FFF4F4',
				displayLimit: '30',
				layout: 'list',
				sortOrder: '20',
				showDescription: 'on',
				headersJson: '{}',
				parserJson: '{}',
				cacheTtl: '600',
				isEnabled: 'on'
			})
		).toMatchObject({
			valid: true,
			data: {
				slug: 'baidu-hot',
				description: '百度实时热点榜',
				icon: '百',
				accentColor: '#e5484d',
				surfaceColor: '#fff4f4',
				displayLimit: 30,
				layout: 'list',
				sortOrder: 20,
				showDescription: true
			}
		});
	});
	it('accepts an HTML board and requires its item selector', () => {
		expect(
			validateHotSourceInput({
				name: '网页热榜',
				slug: 'web-hot',
				type: 'html',
				url: 'https://example.com/hot',
				headersJson: '{}',
				parserJson:
					'{"itemSelector":"li.hot-item","titleSelector":"a.title","hotSelector":".num","baseUrl":"https://example.com/hot"}',
				cacheTtl: '900',
				isEnabled: 'on'
			})
		).toMatchObject({
			valid: true,
			data: {
				type: 'html',
				parser: {
					itemSelector: 'li.hot-item',
					titleSelector: 'a.title',
					hotSelector: '.num',
					baseUrl: 'https://example.com/hot'
				}
			}
		});
		expect(
			validateHotSourceInput({
				name: '网页热榜',
				slug: 'web-hot',
				type: 'html',
				url: 'https://example.com/hot',
				headersJson: '{}',
				parserJson: '{"titleSelector":"a"}',
				cacheTtl: '900'
			})
		).toMatchObject({ valid: false, errors: { parserJson: 'HTML 榜单必须配置 itemSelector。' } });
	});
	it('rejects JSON parser fields on an HTML board and the reverse', () => {
		expect(
			validateHotSourceInput({
				name: '网页热榜',
				type: 'html',
				url: 'https://example.com/hot',
				headersJson: '{}',
				parserJson: '{"itemSelector":"li","itemsPath":"data"}',
				cacheTtl: '900'
			})
		).toMatchObject({ valid: false, errors: { parserJson: expect.any(String) } });
		expect(
			validateHotSourceInput({
				name: 'JSON 榜',
				type: 'json',
				url: 'https://example.com/hot.json',
				headersJson: '{}',
				parserJson: '{"itemSelector":"li"}',
				cacheTtl: '900'
			})
		).toMatchObject({ valid: false, errors: { parserJson: expect.any(String) } });
	});
	it('rejects unknown subscription types', () => {
		expect(
			validateHotSourceInput({
				name: '未知',
				type: 'xml',
				url: 'https://example.com/hot',
				headersJson: '{}',
				parserJson: '{}',
				cacheTtl: '900'
			})
		).toMatchObject({ valid: false, errors: { type: '类型必须是 JSON、RSS 或 HTML。' } });
	});
});
