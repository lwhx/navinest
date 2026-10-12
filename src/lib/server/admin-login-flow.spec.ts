import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminLoginReturnTo, GITHUB_RETURN_COOKIE } from '$lib/login-return';
import { load, actions } from '../../routes/login/+page.server';
import { GET as githubStart } from '../../routes/api/auth/github/+server';
import { GET as githubCallback } from '../../routes/api/auth/github/callback/+server';
import { loginUser, setSessionCookie, SESSION_COOKIE } from '$lib/server/user-auth';
import { exchangeGitHubCode, loginWithGitHub, OAUTH_STATE_COOKIE } from '$lib/server/github-oauth';

vi.mock('$lib/server/user-auth', async (original) => ({
	...(await original<typeof import('$lib/server/user-auth')>()),
	loginUser: vi.fn(),
	setSessionCookie: vi.fn()
}));
vi.mock('$lib/server/github-oauth', async (original) => ({
	...(await original<typeof import('$lib/server/github-oauth')>()),
	exchangeGitHubCode: vi.fn(),
	loginWithGitHub: vi.fn()
}));

function event(path: string, enabled: string | undefined = 'true') {
	const url = new URL(path, 'https://nss.whks.de');
	const values = new Map<string, string>();
	const cookies = {
		get: vi.fn((key: string) => values.get(key)),
		set: vi.fn((key: string, value: string) => {
			values.set(key, value);
		}),
		delete: vi.fn((key: string) => {
			values.delete(key);
		})
	};
	return {
		url,
		request: new Request(url),
		cookies,
		values,
		locals: { user: null },
		platform: {
			env: {
				DB: {},
				GITHUB_CLIENT_ID: 'test-client',
				GITHUB_CLIENT_SECRET: 'test-secret',
				GITHUB_LOGIN_ENABLED: enabled as string | undefined
			}
		},
		getClientAddress: () => '127.0.0.1'
	};
}
const returnTo = '/admin/items?type=site&query=' + encodeURIComponent('中文 资源');
const session = { token: 'new-session', expires: new Date('2099-01-01') };
beforeEach(() => vi.clearAllMocks());

describe('single sign-in admin return flow', () => {
	it.each([undefined, 'false', '', 'TRUE', '1'])(
		'blocks both OAuth endpoints when the switch is %s',
		async (enabled) => {
			const request = event('/api/auth/github');
			request.platform.env.GITHUB_LOGIN_ENABLED = enabled;
			const start = await githubStart(request as never);
			expect(start.status).toBe(503);
			expect(start.headers.get('location')).toBeNull();
			expect(start.headers.get('cache-control')).toBe('private, no-store');
			expect(await start.text()).toContain('暂时关闭');
			expect(request.cookies.set).not.toHaveBeenCalled();
			request.values.set(OAUTH_STATE_COOKIE, 'stored-state');
			request.values.set(GITHUB_RETURN_COOKIE, '/admin');
			request.values.set(SESSION_COOKIE, 'existing-session');
			request.url = new URL(
				'/api/auth/github/callback?code=unused&state=stored-state',
				request.url.origin
			);
			const callback = await githubCallback(request as never);
			expect(callback.status).toBe(503);
			expect(request.values.size).toBe(1);
			expect(request.values.get(SESSION_COOKIE)).toBe('existing-session');
			expect(exchangeGitHubCode).not.toHaveBeenCalled();
			expect(loginWithGitHub).not.toHaveBeenCalled();
			expect(setSessionCookie).not.toHaveBeenCalled();
		}
	);
	it('exposes the login option only when explicitly enabled and a client ID exists', async () => {
		for (const [enabled, clientId, expected] of [
			['false', 'configured', false],
			['true', 'configured', true],
			['true', '', false]
		] as const) {
			const request = event('/login', enabled);
			const result = await load({
				...request,
				platform: { env: { GITHUB_LOGIN_ENABLED: enabled, GITHUB_CLIENT_ID: clientId } }
			} as never);
			expect(result).toMatchObject({ githubLoginEnabled: expected });
		}
	});
	it('uses the admin target when already signed in, and home for normal login', async () => {
		for (const [target, expected] of [
			[returnTo, returnTo],
			['https://evil.example/admin', '/'],
			['', '/']
		]) {
			const request = event('/login?returnTo=' + encodeURIComponent(target));
			await expect(
				load({ ...request, locals: { user: { id: 7 } } } as never)
			).rejects.toMatchObject({ status: 303, location: expected });
		}
	});
	it('returns password sign-in to the original admin page', async () => {
		const request = event('/login?returnTo=' + encodeURIComponent(returnTo));
		request.request = new Request(request.url, {
			method: 'POST',
			body: new URLSearchParams({ identifier: 'owner', password: 'test-password' })
		});
		vi.mocked(loginUser).mockResolvedValueOnce({
			ok: true,
			user: { id: 7, email: null, username: 'owner', displayName: '管理员', role: 'admin' },
			...session
		});
		await expect(actions.default(request as never)).rejects.toMatchObject({
			status: 303,
			location: returnTo
		});
		expect(loginUser).toHaveBeenCalledWith(
			request.platform.env.DB,
			'owner',
			'test-password',
			'127.0.0.1',
			{ userAgent: null }
		);
		expect(setSessionCookie).toHaveBeenCalledWith(request.cookies, session.token, session.expires);
	});
	it('keeps failed password sign-in on the form without granting a session', async () => {
		const request = event('/login?returnTo=/admin');
		request.request = new Request(request.url, {
			method: 'POST',
			body: new URLSearchParams({ identifier: 'owner', password: 'wrong' })
		});
		vi.mocked(loginUser).mockResolvedValueOnce({ ok: false, reason: 'locked' });
		expect(await actions.default(request as never)).toMatchObject({
			status: 429,
			data: { identifier: 'owner' }
		});
		expect(setSessionCookie).not.toHaveBeenCalled();
	});
	it('carries the admin target through GitHub using a scoped, expiring HttpOnly cookie', async () => {
		const request = event('/api/auth/github?returnTo=' + encodeURIComponent(returnTo));
		await expect(githubStart(request as never)).rejects.toMatchObject({ status: 302 });
		expect(request.cookies.set).toHaveBeenCalledWith(GITHUB_RETURN_COOKIE, returnTo, {
			path: '/api/auth/github',
			secure: true,
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 600
		});
		request.url = new URL(
			'/api/auth/github/callback?code=test-code&state=' + request.values.get(OAUTH_STATE_COOKIE),
			request.url.origin
		);
		vi.mocked(exchangeGitHubCode).mockResolvedValueOnce({
			providerUserId: '7',
			providerUsername: 'owner',
			email: 'owner@example.test',
			usernameCandidate: 'owner',
			displayName: '管理员',
			avatarUrl: null
		});
		vi.mocked(loginWithGitHub).mockResolvedValueOnce({
			user: {
				id: 7,
				email: 'owner@example.test',
				username: 'owner',
				displayName: '管理员',
				role: 'admin'
			},
			...session
		});
		await expect(githubCallback(request as never)).rejects.toMatchObject({
			status: 303,
			location: returnTo
		});
		expect(request.cookies.delete).toHaveBeenCalledWith(GITHUB_RETURN_COOKIE, {
			path: '/api/auth/github'
		});
		expect(setSessionCookie).toHaveBeenCalledWith(request.cookies, session.token, session.expires);
	});
	it('clears return and state cookies on an invalid OAuth callback without signing in', async () => {
		const request = event('/api/auth/github/callback?code=test-code&state=wrong-state');
		request.values.set(OAUTH_STATE_COOKIE, 'stored-state');
		request.values.set(GITHUB_RETURN_COOKIE, '/admin');
		expect((await githubCallback(request as never)).status).toBe(400);
		expect(request.values.size).toBe(0);
		expect(exchangeGitHubCode).not.toHaveBeenCalled();
		expect(setSessionCookie).not.toHaveBeenCalled();
	});
	it('overwrites a stale admin target when starting normal or malicious-target GitHub sign-in', async () => {
		for (const target of ['', '//evil.example/admin']) {
			const request = event('/api/auth/github?returnTo=' + encodeURIComponent(target));
			request.values.set(GITHUB_RETURN_COOKIE, '/admin');
			await expect(githubStart(request as never)).rejects.toMatchObject({ status: 302 });
			expect(request.values.get(GITHUB_RETURN_COOKIE)).toBe(adminLoginReturnTo(target));
		}
	});
});
