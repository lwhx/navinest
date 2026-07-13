import { validateExternalTarget } from '$lib/server/safe-target';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) =>
	validateExternalTarget(url.searchParams.get('url') ?? '');
