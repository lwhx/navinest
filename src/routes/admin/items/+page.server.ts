import { redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import {
	invalidAction,
	itemFormInput,
	mutationActionError,
	parsePositiveId
} from '$lib/server/admin-mutations';
import { validateItemInput } from '$lib/server/admin-validation';
import { fallbackAdminItems, loadAdminItems } from '$lib/server/services/admin-data';
import {
	AdminWriteError,
	createItem,
	deleteItem,
	updateItem
} from '$lib/server/services/admin-write';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const database = getDatabase(platform);
	let data;
	try {
		data = database ? await loadAdminItems(database) : fallbackAdminItems();
	} catch (error) {
		console.error('Failed to load content administration data.', error);
		data = fallbackAdminItems();
	}
	const editId = parsePositiveId(url.searchParams.get('edit') ?? '');
	return {
		...data,
		mode: url.searchParams.has('create') ? 'create' : editId ? 'edit' : null,
		editing: editId ? (data.items.find((item) => item.id === editId) ?? null) : null
	};
};

export const actions: Actions = {
	create: async ({ platform, request, locals }) => {
		const formData = await request.formData();
		const validation = validateItemInput(itemFormInput(formData));
		if (!validation.valid) return invalidAction(validation, formData);
		try {
			await createItem(requireDatabase(platform), validation.data, locals.admin?.id ?? null);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/items?created=1');
	},
	update: async ({ platform, request }) => {
		const formData = await request.formData();
		const id = parsePositiveId(String(formData.get('id') ?? ''));
		const validation = validateItemInput(itemFormInput(formData));
		if (!id) return mutationActionError(new AdminWriteError('内容 ID 无效。'), formData);
		if (!validation.valid) return invalidAction(validation, formData);
		try {
			await updateItem(requireDatabase(platform), id, validation.data);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/items?updated=1');
	},
	delete: async ({ platform, request }) => {
		const formData = await request.formData();
		const id = parsePositiveId(String(formData.get('id') ?? ''));
		if (!id) return mutationActionError(new AdminWriteError('内容 ID 无效。'), formData);
		try {
			await deleteItem(requireDatabase(platform), id);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/items?deleted=1');
	}
};
