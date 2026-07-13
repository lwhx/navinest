import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ locals }) =>
	locals.user
		? json({ data: locals.user })
		: json({ error: 'Authentication required' }, { status: 401 });
