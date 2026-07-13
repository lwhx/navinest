import { describe, expect, it } from 'vitest';
import {
	createOAuthState,
	normalizeGitHubProfile,
	validateOAuthState
} from '$lib/server/github-oauth';

describe('GitHub OAuth state', () => {
	it('creates an opaque state and validates an exact callback match', () => {
		const state = createOAuthState(Uint8Array.from({ length: 32 }, (_, index) => index));
		expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(validateOAuthState(state, state)).toBe(true);
		expect(validateOAuthState(state, `${state}x`)).toBe(false);
		expect(validateOAuthState(null, state)).toBe(false);
	});
});

describe('GitHub profile normalization', () => {
	it('uses the verified primary email and a stable username candidate', () => {
		expect(
			normalizeGitHubProfile(
				{
					id: 42,
					login: 'Octo-Cat',
					name: ' Octo Cat ',
					email: null,
					avatar_url: 'https://avatars.githubusercontent.com/u/42'
				},
				[
					{ email: 'other@example.com', primary: false, verified: true },
					{ email: 'OCTO@example.com', primary: true, verified: true }
				]
			)
		).toEqual({
			providerUserId: '42',
			providerUsername: 'Octo-Cat',
			email: 'octo@example.com',
			usernameCandidate: 'octo-cat',
			displayName: 'Octo Cat',
			avatarUrl: 'https://avatars.githubusercontent.com/u/42'
		});
	});

	it('rejects profiles without a verified email', () => {
		expect(() =>
			normalizeGitHubProfile(
				{ id: 7, login: 'private', name: null, email: null, avatar_url: null },
				[{ email: 'hidden@example.com', primary: true, verified: false }]
			)
		).toThrow('verified email');
	});
});
