import { describe, it, expect, vi } from 'vitest';
import { POST, GET } from '../../routes/api/user/navigation/workspace/+server';
const prepare = vi.fn(() => {
	throw new Error('private database detail');
});
const event = (body: BodyInit, headers: Record<string, string> = {}, user = true) =>
	({
		locals: { user: user ? { id: 7 } : null },
		platform: { env: { DB: { prepare } } },
		request: new Request('https://nav.example/api/user/navigation/workspace', {
			method: 'POST',
			headers: { origin: 'https://nav.example', 'content-type': 'application/json', ...headers },
			body
		}),
		url: new URL('https://nav.example/api/user/navigation/workspace?runId=bad')
	}) as unknown as Parameters<typeof POST>[0];
describe('navigation workspace request boundary', () => {
	it('requires authentication before reading request data or receipts', async () => {
		expect((await POST(event('{}', {}, false))).status).toBe(401);
		expect((await GET(event('{}', {}, false))).status).toBe(401);
	});
	it('rejects foreign origins, JSONP, oversized actual UTF-8 bytes and invalid payloads', async () => {
		for (const [body, headers, status] of [
			['{}', { origin: 'https://other.example' }, 403],
			['{}', { 'content-type': 'application/jsonp' }, 415],
			['中'.repeat(90000), {}, 413],
			['{}', { 'content-length': '300000' }, 413],
			['[1]', {}, 400],
			['{bad}', {}, 400],
			[new Uint8Array([0xff]), {}, 400]
		] as const) {
			const r = await POST(event(body, headers));
			expect(r.status).toBe(status);
			expect((await r.json()).uncertain).toBe(false);
		}
	});
	it('does not expose internal database errors or assert a failed write when the result is unknown', async () => {
		const response = await POST(
			event(
				JSON.stringify({
					action: 'preview',
					version: 'a'.repeat(64),
					mutation: { kind: 'category-delete', id: 1 }
				})
			)
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: '结果尚未确认，请保留操作批次并核对。',
			uncertain: true
		});
	});
});
