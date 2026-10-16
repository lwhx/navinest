import { fail, redirect } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import {
	loadUserMessages,
	markMessageRead,
	UserMessageError
} from '$lib/server/services/user-messages';
import { messageFilters, messageUrl } from '$lib/messages';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	if (!locals.user) redirect(303, '/login');
	return loadUserMessages(requireDatabase(platform), locals.user.id, url.searchParams);
};
export const actions: Actions = {
	read: async ({ locals, platform, request, url }) => {
		if (!locals.user) redirect(303, '/login');
		const id = Number((await request.formData()).get('id'));
		if (!Number.isSafeInteger(id) || id < 1) return fail(400, { message: '消息编号无效。' });
		try {
			await markMessageRead(requireDatabase(platform), locals.user.id, id);
		} catch (error) {
			return fail(error instanceof UserMessageError ? error.status : 500, {
				message: error instanceof UserMessageError ? error.message : '已读操作未完成，请重试。'
			});
		}
		redirect(303, messageUrl('/user/messages', messageFilters(url.searchParams)));
	}
};
