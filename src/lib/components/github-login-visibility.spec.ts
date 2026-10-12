import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { SITE_SETTINGS_DEFAULTS } from '$lib/types/site';
vi.mock('$app/state', () => ({
	page: { url: new URL('https://nss.whks.de/login'), data: { user: null } },
	navigating: { to: null }
}));
import LoginPage from '../../routes/login/+page.svelte';
import UserPage from '../../routes/user/+page.svelte';
import SettingsPage from '../../routes/user/settings/+page.svelte';

const user = {
	id: 7,
	email: 'owner@example.test',
	username: 'owner',
	displayName: '管理员',
	role: 'admin'
};
function login(githubLoginEnabled: boolean, registrationOpen = false) {
	return render(LoginPage, {
		props: {
			params: {},
			form: null,
			data: {
				user: null,
				site: SITE_SETTINGS_DEFAULTS,
				returnTo: '/admin/users',
				githubLoginEnabled,
				registrationOpen
			}
		}
	}).body;
}

describe('paused GitHub login presentation', () => {
	it('keeps password login and home, with no GitHub action or empty divider', () => {
		const body = login(false);
		expect(body).toContain('name="password"');
		expect(body).toContain('登录管理后台');
		expect(body).toContain('返回首页');
		expect(body).not.toContain('/api/auth/github');
		expect(body).not.toContain('account-divider');
	});
	it('keeps registration independent, and restores the GitHub return target when enabled', () => {
		expect(login(false, true)).toContain('注册新账号');
		expect(login(true)).toContain('/api/auth/github?returnTo=%2Fadmin%2Fusers');
	});
	it('hides only GitHub account sections while preserving admin navigation and password settings', () => {
		for (const enabled of [false, true]) {
			const base = {
				user,
				site: SITE_SETTINGS_DEFAULTS,
				github: true,
				githubLoginEnabled: enabled
			};
			const overview = render(UserPage, {
				props: {
					params: {},
					form: null,
					data: {
						...base,
						profile: null,
						favorites: [],
						footprints: [],
						navigation: { categories: [], links: [] }
					}
				}
			}).body;
			const settings = render(SettingsPage, {
				props: {
					params: {},
					form: null,
					data: { ...base, hasPassword: true, sessions: [], share: { slug: '', enabled: false } }
				}
			}).body;
			expect(overview).toContain('进入后台');
			expect(settings).toContain('修改密码');
			expect(settings).toContain('登录会话');
			expect(overview.includes('GitHub账户')).toBe(enabled);
			expect(settings.includes('第三方登录')).toBe(enabled);
		}
	});
});
