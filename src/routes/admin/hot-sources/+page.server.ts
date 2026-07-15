import { redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { configurationFormInput, parsePositiveId } from '$lib/server/admin-mutations';
import {
	createHotSource,
	deleteHotSource,
	listHotSources,
	moveHotSource,
	updateHotSource,
	validateHotSourceInput
} from '$lib/server/services/hot-sources';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ platform, url }) => {
	const db = getDatabase(platform),
		sources = db ? await listHotSources(db) : [];
	const editId = parsePositiveId(url.searchParams.get('edit') ?? '');
	return {
		sources,
		source: db ? ('database' as const) : ('fallback' as const),
		mode: url.searchParams.has('create') ? 'create' : editId ? 'edit' : null,
		editing: editId ? (sources.find((x) => x.id === editId) ?? null) : null
	};
};
async function mutate(platform: App.Platform | undefined, request: Request, update: boolean) {
	const form = await request.formData(),
		validation = validateHotSourceInput(configurationFormInput(form));
	if (!validation.valid)
		return {
			success: false,
			message: '请检查表单。',
			errors: validation.errors,
			values: Object.fromEntries(form)
		};
	const id = parsePositiveId(String(form.get('id') ?? ''));
	if (update && !id) return { success: false, message: '热榜源 ID 无效。' };
	if (update) await updateHotSource(requireDatabase(platform), id!, validation.data);
	else await createHotSource(requireDatabase(platform), validation.data);
	redirect(303, `/admin/hot-sources?${update ? 'updated' : 'created'}=1`);
}
export const actions: Actions = {
	create: ({ platform, request }) => mutate(platform, request, false),
	update: ({ platform, request }) => mutate(platform, request, true),
	move: async ({ platform, request }) => {
		const form = await request.formData(),
			id = parsePositiveId(String(form.get('id') ?? '')),
			direction = form.get('direction');
		if (!id || (direction !== 'up' && direction !== 'down'))
			return { success: false, message: '榜单排序参数无效。' };
		await moveHotSource(requireDatabase(platform), id, direction);
		redirect(303, '/admin/hot-sources?ordered=1');
	},
	delete: async ({ platform, request }) => {
		const form = await request.formData(),
			id = parsePositiveId(String(form.get('id') ?? ''));
		if (!id) return { success: false, message: '热榜源 ID 无效。' };
		await deleteHotSource(requireDatabase(platform), id);
		redirect(303, '/admin/hot-sources?deleted=1');
	}
};
