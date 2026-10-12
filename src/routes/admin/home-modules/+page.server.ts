import { redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import {
	configurationFormInput,
	invalidAction,
	mutationActionError,
	parsePositiveId
} from '$lib/server/admin-mutations';
import { validateHomeModuleInput } from '$lib/server/admin-validation';
import { fallbackAdminHomeModules, loadAdminHomeModules } from '$lib/server/services/admin-data';
import { listCategories } from '$lib/server/services/categories';
import {
	AdminWriteError,
	createHomeModule,
	deleteHomeModule,
	updateHomeModule
} from '$lib/server/services/admin-write';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const database = getDatabase(platform);
	const data = database ? await loadAdminHomeModules(database) : fallbackAdminHomeModules();
	const editId = parsePositiveId(url.searchParams.get('edit') ?? '');
	return {
		...data,
		categories: database ? await listCategories(database, { visibleOnly: false }) : [],
		mode: url.searchParams.has('create') ? 'create' : editId ? 'edit' : null,
		editing: editId ? (data.modules.find((entry) => entry.id === editId) ?? null) : null
	};
};

export const actions: Actions = {
	create: async ({ platform, request }) => mutate(platform, request, null),
	update: async ({ platform, request }) => mutate(platform, request, 'update'),
	delete: async ({ platform, request }) => {
		const formData = await request.formData();
		const id = parsePositiveId(String(formData.get('id') ?? ''));
		if (!id) return mutationActionError(new AdminWriteError('首页模块 ID 无效。'), formData);
		try {
			await deleteHomeModule(requireDatabase(platform), id);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/home-modules?deleted=1');
	}
};

async function mutate(platform: App.Platform | undefined, request: Request, mode: 'update' | null) {
	const formData = await request.formData();
	const validation = validateHomeModuleInput(configurationFormInput(formData));
	if (!validation.valid) return invalidAction(validation, formData);
	const id = parsePositiveId(String(formData.get('id') ?? ''));
	if (mode && !id) return mutationActionError(new AdminWriteError('首页模块 ID 无效。'), formData);
	try {
		if (mode) await updateHomeModule(requireDatabase(platform), id!, validation.data);
		else await createHomeModule(requireDatabase(platform), validation.data);
	} catch (error) {
		return mutationActionError(error, formData);
	}
	redirect(303, `/admin/home-modules?${mode ? 'updated' : 'created'}=1`);
}
