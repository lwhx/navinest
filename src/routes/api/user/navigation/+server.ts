import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import {
	createCustomCategory,
	createCustomLink,
	CustomNavigationError,
	deleteCustomCategory,
	deleteCustomLink,
	reorderCustomCategories,
	reorderCustomLinks,
	updateCustomCategory,
	updateCustomLink
} from '$lib/server/services/custom-navigation';
import type { RequestHandler } from './$types';
function id(value: unknown) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function category(body: Record<string, unknown>) {
	return {
		name: String(body.name ?? ''),
		icon: body.icon ? String(body.icon) : null,
		sortOrder: Number(body.sortOrder ?? 0)
	};
}
function link(body: Record<string, unknown>) {
	return {
		categoryId: body.categoryId ? id(body.categoryId) : null,
		title: String(body.title ?? ''),
		url: String(body.url ?? ''),
		summary: body.summary ? String(body.summary) : null,
		sortOrder: Number(body.sortOrder ?? 0),
		status: body.status === 'inactive' ? ('inactive' as const) : ('active' as const)
	};
}
export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	try {
		const body = (await request.json()) as Record<string, unknown>,
			db = requireDatabase(platform);
		if (body.resource === 'category')
			return json(
				{ id: await createCustomCategory(db, locals.user.id, category(body)) },
				{ status: 201 }
			);
		if (body.resource === 'link')
			return json({ id: await createCustomLink(db, locals.user.id, link(body)) }, { status: 201 });
		return json({ error: 'Invalid resource' }, { status: 400 });
	} catch (error) {
		if (error instanceof CustomNavigationError)
			return json({ error: error.message, field: error.field ?? null }, { status: error.status });
		return json({ error: 'Invalid request' }, { status: 400 });
	}
};
export const PATCH: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const db = requireDatabase(platform);
		if (body.resource === 'order') {
			const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
			const reordered =
				body.kind === 'category'
					? await reorderCustomCategories(db, locals.user.id, ids)
					: await reorderCustomLinks(db, locals.user.id, ids);
			return json({ reordered });
		}
		const recordId = id(body.id);
		if (!recordId) return json({ error: 'Invalid ID' }, { status: 400 });
		if (body.resource === 'category')
			await updateCustomCategory(db, locals.user.id, recordId, category(body));
		else if (body.resource === 'link')
			await updateCustomLink(db, locals.user.id, recordId, link(body));
		else return json({ error: 'Invalid resource' }, { status: 400 });
		return json({ success: true });
	} catch (error) {
		if (error instanceof CustomNavigationError)
			return json({ error: error.message, field: error.field ?? null }, { status: error.status });
		return json({ error: 'Invalid request' }, { status: 400 });
	}
};
export const DELETE: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
	try {
		const body = (await request.json()) as Record<string, unknown>,
			recordId = id(body.id);
		if (!recordId) return json({ error: 'Invalid ID' }, { status: 400 });
		const db = requireDatabase(platform);
		if (body.resource === 'category') await deleteCustomCategory(db, locals.user.id, recordId);
		else if (body.resource === 'link') await deleteCustomLink(db, locals.user.id, recordId);
		else return json({ error: 'Invalid resource' }, { status: 400 });
		return json({ success: true });
	} catch (error) {
		if (error instanceof CustomNavigationError)
			return json({ error: error.message }, { status: error.status });
		return json({ error: 'Invalid request' }, { status: 400 });
	}
};
