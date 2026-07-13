import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.admin) error(401, 'Administrator authentication required.');
	return { admin: locals.admin };
};
