import { fail, redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { configurationFormInput, parsePositiveId } from '$lib/server/admin-mutations';
import {
	createHotSource,
	deleteHotSource,
	listHotSources,
	moveHotSource,
	updateHotSource,
	validateHotSourceInput,
	HotSourceWriteError,
	validateHotSourceFetchInput
} from '$lib/server/services/hot-sources';
import {
	inspectHotSource,
	refreshHotSource,
	hotFailure,
	HotNewsError
} from '$lib/server/services/hotnews';
import { hotAlertSummary, reportHotAlerts } from '$lib/server/services/hot-health-alerts';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ platform, url }) => {
	const db = getDatabase(platform),
		sources = db ? await listHotSources(db) : [],
		editId = parsePositiveId(url.searchParams.get('edit') ?? '');
	let alertSummary: Awaited<ReturnType<typeof hotAlertSummary>> = null,
		alertUnavailable = false;
	if (db)
		try {
			alertSummary = await hotAlertSummary(db);
		} catch {
			alertUnavailable = true;
		}
	return {
		sources,
		source: db ? ('database' as const) : ('fallback' as const),
		mode: url.searchParams.has('create') ? 'create' : editId ? 'edit' : null,
		editing: editId ? (sources.find((s) => s.id === editId) ?? null) : null,
		alertSummary,
		alertUnavailable
	};
};
async function mutate(platform: App.Platform | undefined, request: Request, update: boolean) {
	const form = await request.formData(),
		validation = validateHotSourceInput(configurationFormInput(form)),
		values = Object.fromEntries(form);
	if (!validation.valid)
		return fail(400, {
			success: false,
			message: '请检查表单。',
			errors: validation.errors,
			values
		});
	const id = parsePositiveId(String(form.get('id') ?? ''));
	if (update && !id) return fail(400, { success: false, message: '热榜源 ID 无效。', values });
	try {
		if (update) await updateHotSource(requireDatabase(platform), id!, validation.data);
		else await createHotSource(requireDatabase(platform), validation.data);
	} catch (error) {
		return fail(error instanceof HotSourceWriteError ? error.status : 409, {
			success: false,
			message:
				error instanceof HotSourceWriteError
					? error.message
					: '保存未完成，请核对标识是否重复后重试；输入已保留。',
			values
		});
	}
	redirect(303, `/admin/hot-sources?${update ? 'updated' : 'created'}=1`);
}
export const actions: Actions = {
	create: ({ platform, request }) => mutate(platform, request, false),
	update: ({ platform, request }) => mutate(platform, request, true),
	preview: async ({ request }) => {
		const form = await request.formData(),
			values = Object.fromEntries(form),
			validation = validateHotSourceFetchInput(values);
		if (!validation.valid)
			return fail(400, {
				success: false,
				message: '请检查订阅配置。',
				errors: validation.errors,
				values
			});
		try {
			return {
				success: true,
				message: '解析检查完成；当前配置与缓存尚未改动。',
				values,
				preview: await inspectHotSource(validation.data)
			};
		} catch (error) {
			const failure = hotFailure(error);
			return fail(error instanceof HotNewsError ? error.status : 500, {
				success: false,
				message: failure.error + ' ' + failure.tip,
				values
			});
		}
	},
	refresh: async ({ platform, request }) => {
		const form = await request.formData(),
			id = parsePositiveId(String(form.get('id') ?? ''));
		if (!id) return fail(400, { success: false, message: '热榜源 ID 无效。' });
		const db = requireDatabase(platform),
			options = { alertWebhookUrl: platform?.env?.ALERT_WEBHOOK_URL };
		try {
			const result = await refreshHotSource(db, id),
				alert = await reportHotAlerts(db, `source:${id}:${crypto.randomUUID()}`, options);
			return {
				success: true,
				message: `缓存刷新完成，共 ${result.count} 条。${alert.warning ?? ''}`
			};
		} catch (error) {
			if (!(error instanceof HotNewsError) || ![404, 409].includes(error.status))
				await reportHotAlerts(db, `source:${id}:${crypto.randomUUID()}`, options);
			const failure = hotFailure(error);
			return fail(error instanceof HotNewsError ? error.status : 500, {
				success: false,
				message: failure.error + ' ' + failure.tip
			});
		}
	},
	move: async ({ platform, request }) => {
		const form = await request.formData(),
			id = parsePositiveId(String(form.get('id') ?? '')),
			direction = form.get('direction');
		if (!id || (direction !== 'up' && direction !== 'down'))
			return fail(400, { success: false, message: '榜单排序参数无效。' });
		try {
			await moveHotSource(requireDatabase(platform), id, direction);
		} catch {
			return fail(500, { success: false, message: '排序未完成，请刷新后核对。' });
		}
		redirect(303, '/admin/hot-sources?ordered=1');
	},
	delete: async ({ platform, request }) => {
		const form = await request.formData(),
			id = parsePositiveId(String(form.get('id') ?? ''));
		if (!id) return fail(400, { success: false, message: '热榜源 ID 无效。' });
		if (form.get('confirmed') !== 'yes')
			return fail(400, { success: false, message: '请先确认删除此榜单及其缓存。' });
		try {
			await deleteHotSource(requireDatabase(platform), id);
		} catch {
			return fail(500, { success: false, message: '删除结果待核对，请刷新列表。' });
		}
		redirect(303, '/admin/hot-sources?deleted=1');
	}
};
