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
				isEnabled: true
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
});
