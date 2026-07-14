import { redirect } from '@sveltejs/kit';
import { validateExternalTarget } from '$lib/server/safe-target';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const result = validateExternalTarget(url.searchParams.get('url') ?? '');
	if (result.valid) redirect(302, result.target);
	return result;
};
