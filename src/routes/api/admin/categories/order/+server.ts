import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { mutationApiError, readJsonObject } from '$lib/server/admin-mutations';
import { AdminWriteError } from '$lib/server/services/admin-write';
import { reorderCategories } from '$lib/server/services/category-order';
import type { RequestHandler } from './$types';
const sortableTypes = new Set(['site', 'post']);
export const PUT: RequestHandler = async ({ platform, request }) => {
	try {
		const input = await readJsonObject(request),
			type = typeof input.type === 'string' && sortableTypes.has(input.type) ? input.type : null,
			rawParent = input.parentId,
			parentId =
				rawParent === null || rawParent === undefined || rawParent === ''
					? null
					: Number(rawParent),
			categoryIds = Array.isArray(input.categoryIds) ? input.categoryIds.map(Number) : [];
		if (
			!type ||
			(parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) ||
			categoryIds.some((id) => !Number.isInteger(id) || id <= 0)
		)
			throw new AdminWriteError('排序参数无效。');
		await reorderCategories(requireDatabase(platform), { type, parentId, categoryIds });
		return json({ success: true });
	} catch (error) {
		return mutationApiError(error);
	}
};
