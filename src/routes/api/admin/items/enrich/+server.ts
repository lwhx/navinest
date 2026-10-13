import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { fetchWebSnapshot, WebFetchError } from '$lib/server/services/web-enrichment';
import { readJsonObject } from '$lib/server/admin-mutations';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.admin) return json({ error: '需要管理员权限。' }, { status: 403 });
	try {
		const body = await readJsonObject(request);
		const url = typeof body.url === 'string' ? body.url.trim() : '';
		if (!url || url.length > 2048) return json({ error: '请输入有效的网址。' }, { status: 400 });
		const snapshot = await fetchWebSnapshot(url);
		const excludeId = Number.isSafeInteger(body.excludeId) ? Number(body.excludeId) : 0;
		const { results: duplicates } = await requireDatabase(platform)
			.prepare(
				"SELECT i.id, i.title FROM item_meta m JOIN items i ON i.id=m.item_id WHERE m.meta_key='site_url' AND i.id<>? AND (rtrim(m.meta_value,'/')=rtrim(?,'/') OR rtrim(m.meta_value,'/')=rtrim(?,'/')) LIMIT 5"
			)
			.bind(excludeId, url, snapshot.fetchedUrl)
			.all<{ id: number; title: string }>();
		return json({ title: snapshot.title, description: snapshot.description, duplicates });
	} catch (error) {
		if (error instanceof WebFetchError) return json({ error: error.message }, { status: 422 });
		return json({ error: '网页信息读取失败，请手动填写或稍后重试。' }, { status: 503 });
	}
};
