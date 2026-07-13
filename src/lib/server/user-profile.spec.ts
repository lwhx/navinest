import { describe, expect, it } from 'vitest';
import { validateUserProfileInput } from '$lib/server/user-profile';

describe('user profile validation', () => {
	it('normalizes editable profile fields', () => {
		expect(
			validateUserProfileInput({
				displayName: ' Black Ice ',
				email: ' FLYBCC@OUTLOOK.COM ',
				avatarFileId: '12',
				coverFileId: ''
			})
		).toEqual({
			valid: true,
			data: {
				displayName: 'Black Ice',
				email: 'flybcc@outlook.com',
				avatarFileId: 12,
				coverFileId: null
			}
		});
	});

	it('rejects malformed names, email addresses and file IDs', () => {
		expect(
			validateUserProfileInput({
				displayName: '',
				email: 'not-an-email',
				avatarFileId: '-1',
				coverFileId: 'nope'
			})
		).toMatchObject({
			valid: false,
			errors: {
				displayName: expect.any(String),
				email: expect.any(String),
				avatarFileId: expect.any(String),
				coverFileId: expect.any(String)
			}
		});
	});
});
