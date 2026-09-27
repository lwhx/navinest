import { redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { invalidAction, mutationActionError } from '$lib/server/admin-mutations';
import {
	listMessageBatches,
	listMessageRecipients,
	messageStats,
	sendAdminMessage,
	validateAdminMessageInput,
	withdrawMessageBatch
} from '$lib/server/services/admin-messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	const database = getDatabase(platform);
	if (!database)
		return {
			source: 'fallback' as const,
			recipients: [],
			batches: [],
			stats: { batches: 0, announcements: 0, system: 0, review: 0, unread: 0 }
		};
	const [recipients, batches, stats] = await Promise.all([
		listMessageRecipients(database),
		listMessageBatches(database),
		messageStats(database)
	]);
	return { source: 'database' as const, recipients, batches, stats };
};

export const actions: Actions = {
	send: async ({ platform, request, locals }) => {
		const formData = await request.formData();
		const validation = validateAdminMessageInput(Object.fromEntries(formData));
		if (!validation.valid) return invalidAction(validation, formData);
		try {
			await sendAdminMessage(requireDatabase(platform), locals.admin?.id ?? null, validation.data);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/messages?sent=1');
	},
	withdraw: async ({ platform, request }) => {
		const formData = await request.formData();
		const batchId = String(formData.get('batchId') ?? '');
		try {
			await withdrawMessageBatch(requireDatabase(platform), batchId);
		} catch (error) {
			return mutationActionError(error, formData);
		}
		redirect(303, '/admin/messages?withdrawn=1');
	}
};
