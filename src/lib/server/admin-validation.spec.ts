import { describe, expect, it } from 'vitest';
import {
	validateCategoryInput,
	validateItemInput,
	validateTagInput
} from '$lib/server/admin-validation';

describe('administrator input validation', () => {
	it('normalizes valid category and tag input', () => {
		expect(
			validateCategoryInput({
				type: 'site',
				parentId: '',
				name: ' 开发工具 ',
				slug: 'dev-tools',
				sortOrder: '20',
				isVisible: 'on'
			})
		).toEqual({
			valid: true,
			data: {
				type: 'site',
				parentId: null,
				name: '开发工具',
				slug: 'dev-tools',
				icon: null,
				description: null,
				sortOrder: 20,
				isVisible: true
			}
		});
		expect(validateTagInput({ type: 'post', name: 'Svelte', slug: 'svelte' })).toMatchObject({
			valid: true,
			data: { type: 'post', name: 'Svelte', slug: 'svelte' }
		});
	});

	it('returns field errors for malformed identifiers and slugs', () => {
		const category = validateCategoryInput({
			type: 'video',
			parentId: '-2',
			name: '',
			slug: 'Bad Slug'
		});

		expect(category).toMatchObject({
			valid: false,
			errors: {
				type: expect.any(String),
				parentId: expect.any(String),
				name: expect.any(String),
				slug: expect.any(String)
			}
		});
	});

	it('validates content relations, state and external metadata', () => {
		const valid = validateItemInput({
			type: 'site',
			categoryId: '3',
			title: 'Cloudflare',
			slug: 'cloudflare',
			status: 'published',
			visibility: 'public',
			tagIds: ['4', '4', 7],
			meta: { site_url: ' https://cloudflare.com ', site_type: 'service' }
		});

		expect(valid).toMatchObject({
			valid: true,
			data: {
				categoryId: 3,
				status: 'published',
				tagIds: [4, 7],
				meta: { site_url: 'https://cloudflare.com', site_type: 'service' }
			}
		});

		const invalid = validateItemInput({
			type: 'site',
			title: 'Internal',
			slug: 'internal',
			status: 'removed',
			visibility: 'team',
			tagIds: '1,nope',
			meta: { site_url: 'http://127.0.0.1', book_author: 'wrong type' }
		});
		expect(invalid).toMatchObject({
			valid: false,
			errors: {
				status: expect.any(String),
				visibility: expect.any(String),
				tagIds: expect.any(String),
				meta: expect.any(String),
				'meta.site_url': expect.any(String)
			}
		});
	});
});
