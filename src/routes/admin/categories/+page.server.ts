import { redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import {
	categoryFormInput,
	invalidAction,
	mutationActionError,
	parsePositiveId
} from '$lib/server/admin-mutations';
import { validateCategoryInput } from '$lib/server/admin-validation';
import { fallbackAdminCategories, loadAdminCategories } from '$lib/server/services/admin-data';
import {
	AdminWriteError,
	createCategory,
	deleteCategory,
	updateCategory
} from '$lib/server/services/admin-write';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const database = getDatabase(platform);
	const data = database ? await loadAdminCategories(database) : fallbackAdminCategories();
	const editId = parsePositiveId(url.searchParams.get('edit') ?? ''),
		parentId = parsePositiveId(url.searchParams.get('parent') ?? '');
	return {
		...data,
		mode: url.searchParams.has('create') ? 'create' : editId ? 'edit' : null,
		createParent: parentId
			? (data.categories.find((category) => category.id === parentId) ?? null)
			: null,
		editing: editId ? (data.categories.find((category) => category.id === editId) ?? null) : null
	};
};

export const actions: Actions = {
	create: async ({ platform, request }) => {
		const formData = await request.formData();
		const validation = validateCategoryInput(categoryFormInput(formData));
		if (!validation.valid) return invalidAction(validation, formData);
		try {
			await createCategory(requireDatabase(platform), validation.data);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/categories?created=1');
	},
	update: async ({ platform, request }) => {
		const formData = await request.formData();
		const id = parsePositiveId(String(formData.get('id') ?? ''));
		const validation = validateCategoryInput(categoryFormInput(formData));
		if (!id) return mutationActionError(new AdminWriteError('分类 ID 无效。'), formData);
		if (!validation.valid) return invalidAction(validation, formData);
		try {
			await updateCategory(requireDatabase(platform), id, validation.data);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/categories?updated=1');
	},
	delete: async ({ platform, request }) => {
		const formData = await request.formData();
		const id = parsePositiveId(String(formData.get('id') ?? ''));
		if (!id) return mutationActionError(new AdminWriteError('分类 ID 无效。'), formData);
		try {
			await deleteCategory(requireDatabase(platform), id);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/categories?deleted=1');
	}
};
