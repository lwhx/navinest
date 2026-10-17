import { json } from '@sveltejs/kit';
import { validateHotSourceFetchInput } from '$lib/server/services/hot-source-config';
import { inspectHotSource, hotFailure, HotNewsError } from '$lib/server/services/hotnews';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ locals, request, url }) => {
	if (!locals.admin) return json({ error: '需要管理员身份。' }, { status: 403 });
	if (request.headers.get('origin') !== url.origin)
		return json({ error: '请求来源无效。' }, { status: 403 });
	if (!request.headers.get('content-type')?.includes('application/json'))
		return json({ error: '请使用 JSON 请求。' }, { status: 415 });
	try {
		const reader = request.body?.getReader();
		let size = 0;
		const chunks: Uint8Array[] = [];
		if (!reader) return json({ error: '请求正文为空。' }, { status: 400 });
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.length;
			if (size > 65536) {
				await reader.cancel();
				return json({ error: '配置内容超过 64 KiB 限制。' }, { status: 413 });
			}
			chunks.push(next.value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}
		let body: unknown;
		try {
			body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		} catch {
			return json({ error: '请求正文必须是有效 UTF-8 JSON。' }, { status: 400 });
		}
		if (!body || typeof body !== 'object' || Array.isArray(body))
			return json({ error: '请求正文必须是 JSON 对象。' }, { status: 400 });
		const validation = validateHotSourceFetchInput(body as Record<string, unknown>);
		if (!validation.valid)
			return json({ error: '请检查订阅配置。', fields: validation.errors }, { status: 400 });
		return json({ preview: await inspectHotSource(validation.data) });
	} catch (error) {
		return json(hotFailure(error), { status: error instanceof HotNewsError ? error.status : 500 });
	}
};
