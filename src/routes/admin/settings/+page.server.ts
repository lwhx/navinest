import { redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { invalidAction, mutationActionError } from '$lib/server/admin-mutations';
import {
	readSiteSettingsWorkspace,
	saveSiteSettings,
	validateSiteSettingsInput
} from '$lib/server/services/site-settings';
import { SITE_SETTINGS_DEFAULTS } from '$lib/types/site';
import { AdminWriteError } from '$lib/server/services/admin-write';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const database = getDatabase(platform);
	if (!database)
		return {
			settings: { ...SITE_SETTINGS_DEFAULTS },
			revision: '',
			source: 'fallback' as const,
			readError: '',
			saved: false
		};
	try {
		const workspace = await readSiteSettingsWorkspace(database);
		return {
			...workspace,
			source: 'database' as const,
			readError: '',
			saved: url.searchParams.get('saved') === workspace.revision
		};
	} catch (error) {
		return {
			settings: { ...SITE_SETTINGS_DEFAULTS },
			revision: '',
			source: 'unavailable' as const,
			readError:
				error instanceof AdminWriteError
					? error.message
					: '站点设置读取失败，请刷新后重试。当前禁止保存。',
			saved: false
		};
	}
};

export const actions: Actions = {
	preview: async ({ request }) => {
		const formData = await request.formData();
		const validation = validateSiteSettingsInput(Object.fromEntries(formData));
		if (!validation.valid) return invalidAction(validation, formData);
		return {
			preview: validation.data,
			values: Object.fromEntries(formData),
			message: '预览未保存，也未请求公告链接。',
			errors: {}
		};
	},
	save: async ({ platform, request }) => {
		const formData = await request.formData();
		const validation = validateSiteSettingsInput(Object.fromEntries(formData));
		if (!validation.valid) return invalidAction(validation, formData);
		let savedRevision: string;
		try {
			const expected = formData.get('revision');
			if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
				throw new AdminWriteError('缺少设置版本，请重新打开设置页面。', undefined, 409);
			const saved = await saveSiteSettings(requireDatabase(platform), validation.data, expected);
			savedRevision = saved.revision;
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/settings?saved=' + savedRevision);
	}
};
