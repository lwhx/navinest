import { error, fail } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import { AdminWriteError } from '$lib/server/services/admin-write';
import { loadLinkChecks, runLinkChecks } from '$lib/server/services/link-check-workspace';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const db = getDatabase(platform);
	if (!db) error(503, '数据库当前不可用，无法读取网址检查结果。');
	try {
		return await loadLinkChecks(db, url.searchParams);
	} catch {
		error(503, '暂时无法读取网址检查结果，请稍后刷新。');
	}
};
export const actions: Actions = {
	check: async ({ platform, request }) => {
		if (request.headers.get('origin') !== new URL(request.url).origin)
			return fail(403, { message: '请求来源无效。' });
		const db = getDatabase(platform);
		if (!db) return fail(503, { message: '数据库当前不可用，未发起检查。' });
		const form = await request.formData();
		const raw = form.getAll('ids');
		if (raw.some((id) => typeof id !== 'string' || !/^[1-9]\d*$/.test(id)))
			return fail(400, { message: '所选网址无效，请刷新后重试。' });
		try {
			const result = await runLinkChecks(db, raw.map(Number));
			return {
				message: `已记录 ${result.saved} 个检查结果。${result.skipped ? `另有 ${result.skipped} 项在检查时发生变化，未覆盖，请刷新后重新选择。` : '网址内容未修改。'}`
			};
		} catch (cause) {
			if (cause instanceof AdminWriteError) return fail(cause.status, { message: cause.message });
			return fail(503, { message: '检查结果待核对，请刷新列表确认后再重试。' });
		}
	}
};
