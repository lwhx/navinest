import type { RequestEvent } from '@sveltejs/kit';

/** OAuth stays paused unless an operator explicitly restores it. */
export function githubLoginEnabled(platform: RequestEvent['platform']): boolean {
	return platform?.env?.GITHUB_LOGIN_ENABLED === 'true';
}

export function githubLoginDisabledResponse(): Response {
	return new Response('GitHub 登录暂时关闭，请使用账号密码登录。', {
		status: 503,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' }
	});
}
