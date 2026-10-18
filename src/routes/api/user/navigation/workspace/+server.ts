import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { CustomNavigationError } from '$lib/server/services/custom-navigation';
import {
	cancelNavigationMutation,
	commitNavigationMutation,
	navigationReceipt,
	NavigationWorkspaceError,
	prepareNavigationMutation
} from '$lib/server/services/navigation-workspace';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	if (!locals.user) return json({ error: '请先登录。' }, { status: 401 });
	try {
		return json(
			{
				receipt: await navigationReceipt(
					requireDatabase(platform),
					locals.user.id,
					url.searchParams.get('runId')
				)
			},
			{ headers: { 'cache-control': 'private, no-store' } }
		);
	} catch {
		return json({ error: '暂时无法核对操作结果。' }, { status: 503 });
	}
};
export const POST: RequestHandler = async ({ locals, platform, request }) => {
	if (!locals.user) return json({ error: '请先登录。', uncertain: false }, { status: 401 });
	try {
		if (request.headers.get('origin') !== new URL(request.url).origin)
			throw new NavigationWorkspaceError('请求来源无效。', 403);
		if (
			request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
		)
			throw new NavigationWorkspaceError('请提交 JSON。', 415);
		if (Number(request.headers.get('content-length')) > 256 * 1024)
			throw new NavigationWorkspaceError('操作请求过大。', 413);
		if (!request.body) throw new NavigationWorkspaceError('操作内容为空。');
		const reader = request.body.getReader(),
			chunks: Uint8Array[] = [];
		let length = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				length += value.byteLength;
				if (length > 256 * 1024) {
					await reader.cancel();
					throw new NavigationWorkspaceError('操作请求过大。', 413);
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		const bytes = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
			if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
		} catch {
			throw new NavigationWorkspaceError('操作内容格式无效。');
		}
		const db = requireDatabase(platform);
		if (data.action === 'preview')
			return json(
				{ plan: (await prepareNavigationMutation(db, locals.user.id, data)).plan },
				{ headers: { 'cache-control': 'private, no-store' } }
			);
		if (data.action === 'cancel') {
			if (data.confirmed !== true)
				throw new NavigationWorkspaceError('请确认取消未执行的操作。', 428);
			return json({ receipt: await cancelNavigationMutation(db, locals.user.id, data) });
		}
		if (data.action !== 'commit') throw new NavigationWorkspaceError('操作类型无效。');
		return json({ receipt: await commitNavigationMutation(db, locals.user.id, data) });
	} catch (error) {
		if (error instanceof NavigationWorkspaceError)
			return json({ error: error.message, uncertain: error.uncertain }, { status: error.status });
		if (error instanceof CustomNavigationError)
			return json(
				{ error: error.message, field: error.field, uncertain: false },
				{ status: error.status }
			);
		return json(
			{ error: '结果尚未确认，请保留操作批次并核对。', uncertain: true },
			{ status: 503 }
		);
	}
};
