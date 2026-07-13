import { redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import {
	invalidAction,
	mutationActionError,
	parsePositiveId,
	tagFormInput
} from '$lib/server/admin-mutations';
import { validateTagInput } from '$lib/server/admin-validation';
import { fallbackAdminTags, loadAdminTags } from '$lib/server/services/admin-data';
import { AdminWriteError, createTag, deleteTag, updateTag } from '$lib/server/services/admin-write';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const database = getDatabase(platform);
	const data = database ? await loadAdminTags(database) : fallbackAdminTags();
	const editId = parsePositiveId(url.searchParams.get('edit') ?? '');
	return {
		...data,
		mode: url.searchParams.has('create') ? 'create' : editId ? 'edit' : null,
		editing: editId ? (data.tags.find((tag) => tag.id === editId) ?? null) : null
	};
};

export const actions: Actions = {
	create: async ({ platform, request }) => {
		const formData = await request.formData();
		const validation = validateTagInput(tagFormInput(formData));
		if (!validation.valid) return invalidAction(validation, formData);
		try {
			await createTag(requireDatabase(platform), validation.data);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/tags?created=1');
	},
	update: async ({ platform, request }) => {
		const formData = await request.formData();
		const id = parsePositiveId(String(formData.get('id') ?? ''));
		const validation = validateTagInput(tagFormInput(formData));
		if (!id) return mutationActionError(new AdminWriteError('标签 ID 无效。'), formData);
		if (!validation.valid) return invalidAction(validation, formData);
		try {
			await updateTag(requireDatabase(platform), id, validation.data);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/tags?updated=1');
	},
	delete: async ({ platform, request }) => {
		const formData = await request.formData();
		const id = parsePositiveId(String(formData.get('id') ?? ''));
		if (!id) return mutationActionError(new AdminWriteError('标签 ID 无效。'), formData);
		try {
			await deleteTag(requireDatabase(platform), id);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/tags?deleted=1');
	}
};
