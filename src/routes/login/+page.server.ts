import { fail, redirect } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { loginUser, setSessionCookie } from '$lib/server/user-auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return {};
};
export const actions: Actions = {
	default: async ({ platform, request, cookies, getClientAddress }) => {
		const form = await request.formData();
		const identifier = String(form.get('identifier') ?? '');
		const password = String(form.get('password') ?? '');
		if (!identifier.trim() || !password)
			return fail(400, { message: '请输入账号和密码。', identifier });
		const result = await loginUser(
			requireDatabase(platform),
			identifier,
			password,
			getClientAddress()
		);
		if (!result.ok)
			return fail(result.reason === 'locked' ? 429 : 401, {
				message:
					result.reason === 'locked' ? '登录失败次数过多，请 15 分钟后再试。' : '账号或密码错误。',
				identifier
			});
		setSessionCookie(cookies, result.token, result.expires);
		redirect(303, '/');
	}
};
