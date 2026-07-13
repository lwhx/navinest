import { describe, expect, it } from 'vitest';
import { DatabaseUnavailableError } from '$lib/server/db';
import {
	categoryFormInput,
	itemFormInput,
	mutationApiError,
	parsePositiveId,
	readJsonObject
} from '$lib/server/admin-mutations';
import { AdminWriteError } from '$lib/server/services/admin-write';

describe('administrator mutation request handling', () => {
	it('converts form controls into validation input', () => {
		const category = new FormData();
		category.set('type', 'site');
		category.set('name', '工具');
		category.set('isVisible', 'on');
		expect(categoryFormInput(category)).toMatchObject({
			type: 'site',
			name: '工具',
			isVisible: true
		});

		const item = new FormData();
		item.set('type', 'site');
		item.append('tagIds', '2');
		item.append('tagIds', '5');
		item.set('site_url', 'https://example.com');
		item.set('isFeatured', 'on');
		expect(itemFormInput(item)).toMatchObject({
			type: 'site',
			tagIds: ['2', '5'],
			isFeatured: true,
			meta: { site_url: 'https://example.com' }
		});
	});

	it('accepts only JSON object request bodies', async () => {
		await expect(
			readJsonObject(
				new Request('https://example.com', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ title: 'NaviNest' })
				})
			)
		).resolves.toEqual({ title: 'NaviNest' });
		await expect(
			readJsonObject(
				new Request('https://example.com', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: 'not-json'
				})
			)
		).rejects.toBeInstanceOf(AdminWriteError);
	});

	it('maps expected mutation failures to stable API statuses', () => {
		expect(mutationApiError(new DatabaseUnavailableError()).status).toBe(503);
		expect(mutationApiError(new AdminWriteError('不存在', undefined, 404)).status).toBe(404);
		expect(
			mutationApiError(new Error('UNIQUE constraint failed: tags.type, tags.slug')).status
		).toBe(409);
	});

	it('parses only positive integer route identifiers', () => {
		expect(parsePositiveId('7')).toBe(7);
		expect(parsePositiveId('0')).toBeNull();
		expect(parsePositiveId('1.5')).toBeNull();
		expect(parsePositiveId('nope')).toBeNull();
	});
});
