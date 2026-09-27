import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { mutationApiError, readJsonObject, validationApiError } from '$lib/server/admin-mutations';
import {
	listMessageBatches,
	listMessageRecipients,
	messageStats,
	sendAdminMessage,
	validateAdminMessageInput
} from '$lib/server/services/admin-messages';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	try {
		const database = requireDatabase(platform);
		const [recipients, batches, stats] = await Promise.all([
			listMessageRecipients(database),
			listMessageBatches(database),
			messageStats(database)
		]);
		return json({ recipients, batches, stats });
	} catch (error) {
		return mutationApiError(error);
	}
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
	try {
		const validation = validateAdminMessageInput(await readJsonObject(request));
		if (!validation.valid) return validationApiError(validation);
		const result = await sendAdminMessage(
			requireDatabase(platform),
			locals.admin?.id ?? null,
			validation.data
		);
		return json(result, { status: 201 });
	} catch (error) {
		return mutationApiError(error);
	}
};
