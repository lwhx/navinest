import { redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import {
	configurationFormInput,
	invalidAction,
	mutationActionError,
	parsePositiveId
} from '$lib/server/admin-mutations';
import { validateSearchEngineInput } from '$lib/server/admin-validation';
import {
	fallbackAdminSearchEngines,
	loadAdminSearchEngines
} from '$lib/server/services/admin-data';
import {
	AdminWriteError,
	createSearchEngine,
	deleteSearchEngine,
	updateSearchEngine
} from '$lib/server/services/admin-write';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const database = getDatabase(platform);
	const data = database ? await loadAdminSearchEngines(database) : fallbackAdminSearchEngines();
	const editId = parsePositiveId(url.searchParams.get('edit') ?? '');
	return {
		...data,
		mode: url.searchParams.has('create') ? 'create' : editId ? 'edit' : null,
		editing: editId ? (data.searchEngines.find((entry) => entry.id === editId) ?? null) : null
	};
};

export const actions: Actions = {
	create: async ({ platform, request }) => mutate(platform, request, null),
	update: async ({ platform, request }) => mutate(platform, request, 'update'),
	delete: async ({ platform, request }) => {
		const formData = await request.formData();
		const id = parsePositiveId(String(formData.get('id') ?? ''));
		if (!id) return mutationActionError(new AdminWriteError('搜索源 ID 无效。'), formData);
		try {
			await deleteSearchEngine(requireDatabase(platform), id);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/search-engines?deleted=1');
	}
};

async function mutate(platform: App.Platform | undefined, request: Request, mode: 'update' | null) {
	const formData = await request.formData();
	const validation = validateSearchEngineInput(configurationFormInput(formData));
	if (!validation.valid) return invalidAction(validation, formData);
	const id = parsePositiveId(String(formData.get('id') ?? ''));
	if (mode && !id) return mutationActionError(new AdminWriteError('搜索源 ID 无效。'), formData);
	try {
		if (mode) await updateSearchEngine(requireDatabase(platform), id!, validation.data);
		else await createSearchEngine(requireDatabase(platform), validation.data);
	} catch (error) {
		return mutationActionError(error, formData);
	}
	redirect(303, `/admin/search-engines?${mode ? 'updated' : 'created'}=1`);
}
