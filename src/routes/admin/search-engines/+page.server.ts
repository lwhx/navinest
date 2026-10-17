import { fail, redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import {
	configurationFormInput,
	invalidAction,
	mutationActionError,
	parsePositiveId
} from '$lib/server/admin-mutations';
import { validateSearchEngineInput } from '$lib/server/admin-validation';
import { fallbackAdminSearchEngines } from '$lib/server/services/admin-data';
import {
	AdminWriteError,
	createSearchEngine,
	deleteSearchEngine,
	updateSearchEngine
} from '$lib/server/services/admin-write';
import {
	searchSourceView,
	searchSourceWorkspace,
	reorderSearchSource,
	setSearchSourceEnabled
} from '$lib/server/services/search-source-workspace';
import { searchSourceListUrl, searchSourcePreview } from '$lib/search-source';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ platform, url }) => {
	const database = getDatabase(platform),
		workspace = database
			? await searchSourceWorkspace(database, url.searchParams)
			: searchSourceView(fallbackAdminSearchEngines().searchEngines, url.searchParams);
	return {
		...workspace,
		source: database ? ('database' as const) : ('fallback' as const),
		listUrl: searchSourceListUrl(
			new URLSearchParams({ ...workspace.filters, page: String(workspace.page) })
		)
	};
};
function returnTo(form: FormData) {
	try {
		return searchSourceListUrl(
			new URL(String(form.get('returnTo') ?? ''), 'https://navinest.invalid').searchParams
		);
	} catch {
		return '/admin/search-engines';
	}
}
async function mutate(platform: App.Platform | undefined, request: Request, update: boolean) {
	const form = await request.formData(),
		validation = validateSearchEngineInput(configurationFormInput(form));
	if (!validation.valid) return invalidAction(validation, form);
	const id = parsePositiveId(String(form.get('id') ?? ''));
	if (update && !id) return mutationActionError(new AdminWriteError('搜索源 ID 无效。'), form);
	try {
		if (update) await updateSearchEngine(requireDatabase(platform), id!, validation.data);
		else await createSearchEngine(requireDatabase(platform), validation.data);
	} catch (error) {
		if (
			error instanceof Error &&
			/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(error.message)
		)
			return fail(409, {
				success: false,
				message: '唯一标识已被其他搜索源使用，请修改后重试。',
				errors: { key: '此标识已存在。' },
				values: Object.fromEntries(form)
			});
		return mutationActionError(error, form);
	}
	redirect(303, returnTo(form));
}
export const actions: Actions = {
	create: ({ platform, request }) => mutate(platform, request, false),
	update: ({ platform, request }) => mutate(platform, request, true),
	preview: async ({ request }) => {
		const form = await request.formData(),
			values = Object.fromEntries(form),
			preview = searchSourcePreview(
				String(form.get('urlTemplate') ?? ''),
				String(form.get('sampleQuery') ?? '')
			);
		return preview.valid
			? { success: true, message: '链接预览已生成，配置尚未保存。', values, preview }
			: fail(400, {
					success: false,
					message: preview.error,
					errors: { urlTemplate: preview.error },
					values
				});
	},
	toggle: async ({ platform, request }) => {
		const form = await request.formData(),
			id = parsePositiveId(String(form.get('id') ?? '')),
			expected = form.get('expected');
		if (!id || !['0', '1'].includes(String(expected)))
			return mutationActionError(new AdminWriteError('状态参数无效。'), form);
		try {
			await setSearchSourceEnabled(requireDatabase(platform), id, expected === '1');
		} catch (error) {
			return mutationActionError(error, form);
		}
		redirect(303, returnTo(form));
	},
	move: async ({ platform, request }) => {
		const form = await request.formData(),
			id = parsePositiveId(String(form.get('id') ?? '')),
			direction = form.get('direction');
		if (!id || !['up', 'down', 'first'].includes(String(direction)))
			return mutationActionError(new AdminWriteError('排序参数无效。'), form);
		try {
			await reorderSearchSource(
				requireDatabase(platform),
				id,
				direction as 'up' | 'down' | 'first'
			);
		} catch (error) {
			return mutationActionError(error, form);
		}
		redirect(303, returnTo(form));
	},
	delete: async ({ platform, request }) => {
		const form = await request.formData(),
			id = parsePositiveId(String(form.get('id') ?? ''));
		if (!id || form.get('confirmed') !== 'yes')
			return mutationActionError(new AdminWriteError('请先确认删除该搜索源。'), form);
		try {
			await deleteSearchEngine(requireDatabase(platform), id);
		} catch (error) {
			return mutationActionError(error, form);
		}
		redirect(303, returnTo(form));
	}
};
