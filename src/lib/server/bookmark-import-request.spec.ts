import { describe, it, expect } from 'vitest';
import { readBookmarkRequest, bookmarkError } from './bookmark-import-request';
import { BookmarkImportError } from './services/bookmark-import-workspace';
const request = (body: BodyInit, headers: Record<string, string> = {}) =>
	new Request('https://nav.example/api/user/navigation/import/preview', {
		method: 'POST',
		headers: { origin: 'https://nav.example', 'content-type': 'application/json', ...headers },
		body
	});
describe('bounded bookmark requests', () => {
	it('reads JSON on the current origin', async () => {
		expect(await readBookmarkRequest(request('{"html":"测试"}'))).toEqual({ html: '测试' });
	});
	it('rejects missing or foreign origins and non-JSON content types', async () => {
		for (const origin of ['', 'null', 'https://other.example'])
			await expect(readBookmarkRequest(request('{}', { origin }))).rejects.toMatchObject({
				status: 403
			});
		await expect(
			readBookmarkRequest(request('{}', { 'content-type': 'application/jsonp' }))
		).rejects.toMatchObject({ status: 415 });
	});
	it('rejects oversized content lengths and limits actual bytes with no length header', async () => {
		await expect(
			readBookmarkRequest(request('{}', { 'content-length': String(5 * 1024 * 1024) }))
		).rejects.toMatchObject({ status: 413 });
		await expect(
			readBookmarkRequest(request('x'.repeat(4 * 1024 * 1024 + 1)))
		).rejects.toMatchObject({ status: 413 });
	});
	it('rejects malformed JSON and invalid UTF-8 without leaking parser details', async () => {
		await expect(readBookmarkRequest(request('{bad}'))).rejects.toThrow('格式无效');
		await expect(readBookmarkRequest(request(new Uint8Array([0xff])))).rejects.toThrow('格式无效');
	});
	it('preserves uncertainty and safe error messages in responses', async () => {
		const response = bookmarkError(new BookmarkImportError('请核对', 503, true));
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: '请核对', uncertain: true });
		expect(
			await bookmarkError(new Error('secret transport detail'), true).json()
		).not.toHaveProperty('stack');
	});
});
