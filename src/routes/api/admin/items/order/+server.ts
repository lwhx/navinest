import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { mutationApiError, readJsonObject } from '$lib/server/admin-mutations';
import { AdminWriteError } from '$lib/server/services/admin-write';
import { reorderItems } from '$lib/server/services/content-order';
import type { ContentType } from '$lib/types/content';
import type { RequestHandler } from './$types';
const types = new Set<ContentType>(['site', 'post', 'app', 'book', 'bulletin']);
export const PUT: RequestHandler = async ({ platform, request }) => {
	try {
		const input = await readJsonObject(request),
			type =
				typeof input.type === 'string' && types.has(input.type as ContentType)
					? (input.type as ContentType)
					: null,
			categoryId = Number(input.categoryId),
			itemIds = Array.isArray(input.itemIds) ? input.itemIds.map(Number) : [];
		if (
			!type ||
			!Number.isInteger(categoryId) ||
			categoryId <= 0 ||
			itemIds.some((id) => !Number.isInteger(id) || id <= 0)
		)
			throw new AdminWriteError('排序参数无效。');
		await reorderItems(requireDatabase(platform), { type, categoryId, itemIds });
		return json({ success: true });
	} catch (error) {
		return mutationApiError(error);
	}
};
