import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { mutationApiError, readJsonObject, validationApiError } from '$lib/server/admin-mutations';
import {
	readSiteSettingsWorkspace,
	saveSiteSettings,
	validateSiteSettingsInput
} from '$lib/server/services/site-settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	try {
		const current = await readSiteSettingsWorkspace(requireDatabase(platform));
		return json({ data: current.settings, revision: current.revision });
	} catch (error) {
		return mutationApiError(error);
	}
};

export const PUT: RequestHandler = async ({ platform, request, url }) => {
	if (request.headers.get('origin') !== url.origin)
		return json({ error: '请求来源无效。' }, { status: 403 });
	try {
		const input = await readJsonObject(request);
		if (typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision))
			return json({ error: '请先读取最新设置并提供 revision。' }, { status: 428 });
		const validation = validateSiteSettingsInput(input);
		if (!validation.valid) return validationApiError(validation);
		const saved = await saveSiteSettings(
			requireDatabase(platform),
			validation.data,
			input.revision
		);
		return json({ data: saved.settings, revision: saved.revision });
	} catch (error) {
		return mutationApiError(error);
	}
};
