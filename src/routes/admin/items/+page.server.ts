import { error, redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import {
	invalidAction,
	itemFormInput,
	mutationActionError,
	parsePositiveId
} from '$lib/server/admin-mutations';
import { validateItemInput } from '$lib/server/admin-validation';
import { fallbackAdminItems } from '$lib/server/services/admin-data';
import { loadAdminContent, paginateAdminFallback } from '$lib/server/services/admin-content';
import { listItems } from '$lib/server/services/items';
import {
	AdminWriteError,
	requireManagedType,
	createItem,
	deleteItem,
	updateItem
} from '$lib/server/services/admin-write';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const database = getDatabase(platform);
	let data;
	try {
		const fallback = database ? null : fallbackAdminItems();
		data = database
			? await loadAdminContent(database, url.searchParams)
			: { ...fallback!, ...paginateAdminFallback(fallback!, url.searchParams) };
	} catch (cause) {
		console.error('Failed to load content administration data.', cause);
		error(503, '内容列表暂时无法读取，请稍后重试。');
	}
	const editId = parsePositiveId(url.searchParams.get('edit') ?? '');
	const editing =
		editId && database
			? ((await listItems(database, { status: null, visibility: null, limit: 1, id: editId }))[0] ??
				null)
			: null;
	return {
		...data,
		mode: url.searchParams.has('create') ? 'create' : editId ? 'edit' : null,
		initialType: data.filters.type,
		initialCategoryId: data.filters.category === 'all' ? '' : data.filters.category,
		editing
	};
};

export const actions: Actions = {
	create: async ({ platform, request, locals }) => {
		const formData = await request.formData();
		const validation = validateItemInput(itemFormInput(formData));
		if (!validation.valid) return invalidAction(validation, formData);
		try {
			await requireManagedType(requireDatabase(platform), 'items', validation.data.type);
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
			await requireManagedType(requireDatabase(platform), 'items', validation.data.type, id);
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
