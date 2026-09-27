import { redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { invalidAction, mutationActionError, parsePositiveId } from '$lib/server/admin-mutations';
import {
	createAdminUser,
	listAdminUsers,
	resetAdminUserPassword,
	setAdminUserStatus,
	updateAdminUser,
	validateAdminUserInput
} from '$lib/server/services/admin-users';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url, locals }) => {
	const database = getDatabase(platform);
	const users = database ? await listAdminUsers(database) : [];
	const editId = parsePositiveId(url.searchParams.get('edit') ?? '');
	const passwordId = parsePositiveId(url.searchParams.get('password') ?? '');
	return {
		users,
		source: database ? ('database' as const) : ('fallback' as const),
		currentAdminId: locals.admin?.id ?? null,
		mode: url.searchParams.has('create') ? ('create' as const) : editId ? ('edit' as const) : null,
		editing: editId ? (users.find((user) => user.id === editId) ?? null) : null,
		passwordFor: passwordId ? (users.find((user) => user.id === passwordId) ?? null) : null
	};
};

function userFormInput(formData: FormData) {
	return Object.fromEntries(formData);
}

export const actions: Actions = {
	create: async ({ platform, request }) => {
		const formData = await request.formData();
		const validation = validateAdminUserInput(userFormInput(formData), {
			requirePassword: true
		});
		if (!validation.valid) return invalidAction(validation, formData);
		try {
			await createAdminUser(requireDatabase(platform), validation.data);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/users?created=1');
	},
	update: async ({ platform, request }) => {
		const formData = await request.formData();
		const id = parsePositiveId(String(formData.get('id') ?? ''));
		const validation = validateAdminUserInput(
			{ ...userFormInput(formData), password: '' },
			{ requirePassword: false }
		);
		if (!id) return invalidAction({ valid: false, errors: { id: '用户 ID 无效。' } }, formData);
		if (!validation.valid) return invalidAction(validation, formData);
		try {
			await updateAdminUser(requireDatabase(platform), id, validation.data);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/users?updated=1');
	},
	password: async ({ platform, request }) => {
		const formData = await request.formData();
		const id = parsePositiveId(String(formData.get('id') ?? ''));
		const password = String(formData.get('password') ?? '');
		if (!id) return invalidAction({ valid: false, errors: { id: '用户 ID 无效。' } }, formData);
		try {
			await resetAdminUserPassword(requireDatabase(platform), id, password);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/users?password-reset=1');
	},
	status: async ({ platform, request }) => {
		const formData = await request.formData();
		const id = parsePositiveId(String(formData.get('id') ?? ''));
		const status = String(formData.get('status') ?? '');
		if (!id) return invalidAction({ valid: false, errors: { id: '用户 ID 无效。' } }, formData);
		if (status !== 'active' && status !== 'disabled')
			return invalidAction({ valid: false, errors: { status: '状态无效。' } }, formData);
		try {
			await setAdminUserStatus(requireDatabase(platform), id, status);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/users?updated=1');
	}
};
