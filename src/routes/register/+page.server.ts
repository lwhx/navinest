import { fail, redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { loadSiteSettings } from '$lib/server/services/site-settings';
import {
	registerUser,
	RegistrationError,
	setSessionCookie,
	validateRegistrationInput
} from '$lib/server/user-auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (locals.user) redirect(303, '/');
	return { registrationOpen: (await loadSiteSettings(getDatabase(platform))).registrationOpen };
};

function submittedValues(form: FormData) {
	return {
		username: String(form.get('username') ?? ''),
		displayName: String(form.get('displayName') ?? ''),
		email: String(form.get('email') ?? '')
	};
}

export const actions: Actions = {
	default: async ({ platform, request, cookies, getClientAddress }) => {
		const form = await request.formData();
		const values = submittedValues(form);
		const settings = await loadSiteSettings(getDatabase(platform));
		if (!settings.registrationOpen)
			return fail(403, {
				message: '站点当前未开放注册，请联系管理员开通账号。',
				errors: {},
				values
			});
		const validation = validateRegistrationInput({ ...values, password: form.get('password') });
		if (!validation.valid)
			return fail(400, { message: '请检查填写内容。', errors: validation.errors, values });
		try {
			const result = await registerUser(requireDatabase(platform), validation.data, {
				userAgent: request.headers.get('user-agent'),
				ipAddress: getClientAddress()
			});
			setSessionCookie(cookies, result.token, result.expires);
		} catch (error) {
			if (error instanceof RegistrationError)
				return fail(error.status, {
					message: error.message,
					errors: error.field ? { [error.field]: error.message } : {},
					values
				});
			throw error;
		}
		redirect(303, '/user');
	}
};
