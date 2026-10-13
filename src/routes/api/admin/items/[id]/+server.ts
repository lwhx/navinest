import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { validateItemInput } from '$lib/server/admin-validation';
import {
	mutationApiError,
	parsePositiveId,
	readJsonObject,
	validationApiError
} from '$lib/server/admin-mutations';
import {
	AdminWriteError,
	deleteItem,
	updateItem,
	requireManagedType
} from '$lib/server/services/admin-write';
import type { RequestHandler } from './$types';

function idFrom(params: { id: string }): number {
	const id = parsePositiveId(params.id);
	if (!id) throw new AdminWriteError('内容 ID 无效。');
	return id;
}

export const PATCH: RequestHandler = async ({ platform, request, params }) => {
	try {
		const validation = validateItemInput(await readJsonObject(request));
		if (!validation.valid) return validationApiError(validation);
		await requireManagedType(
			requireDatabase(platform),
			'items',
			validation.data.type,
			idFrom(params)
		);
		await updateItem(requireDatabase(platform), idFrom(params), validation.data);
		return json({ success: true });
	} catch (error) {
		return mutationApiError(error);
	}
};

export const DELETE: RequestHandler = async ({ platform, params }) => {
	try {
		await deleteItem(requireDatabase(platform), idFrom(params));
		return new Response(null, { status: 204 });
	} catch (error) {
		return mutationApiError(error);
	}
};
