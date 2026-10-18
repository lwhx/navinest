import { describe, expect, it, vi } from 'vitest';
import { probeLink } from './link-probe';
const url = 'https://example.com/start';
const resolveHost = async () => ['93.184.216.34'];

describe('bounded manual link probes', () => {
	it.each([200, 204, 206])('records successful HTTP %i without reading a body', async (status) => {
		const cancel = vi.fn(),
			response = new Response(status === 204 ? null : new ReadableStream({ cancel }), { status });
		const fetcher = vi.fn<typeof fetch>(async () => response);
		expect(await probeLink(url, { fetcher, resolveHost })).toMatchObject({
			url,
			status: 'reachable',
			httpStatus: status,
			reason: 'ok'
		});
		if (status !== 204) expect(cancel).toHaveBeenCalledOnce();
		expect(fetcher.mock.calls[0]).toHaveLength(2);
	});
	it.each([404, 410])('separates gone HTTP %i from uncertainty', async (status) => {
		expect(
			await probeLink(url, { resolveHost, fetcher: async () => new Response(null, { status }) })
		).toMatchObject({ status: 'gone', httpStatus: status });
	});
	it.each([401, 403, 429, 500, 503, 304])('keeps HTTP %i inconclusive', async (status) => {
		expect(
			await probeLink(url, { resolveHost, fetcher: async () => new Response(null, { status }) })
		).toMatchObject({ status: 'uncertain', httpStatus: status });
	});
	it.each([405, 501])('falls back from HEAD %i to a body-cancelled range GET', async (status) => {
		const calls: RequestInit[] = [],
			cancel = vi.fn();
		const fetcher: typeof fetch = async (_input, init) => {
			calls.push(init!);
			return calls.length === 1
				? new Response(null, { status })
				: new Response(new ReadableStream({ cancel }));
		};
		expect(await probeLink(url, { resolveHost, fetcher })).toMatchObject({ status: 'reachable' });
		expect(calls.map((call) => call.method)).toEqual(['HEAD', 'GET']);
		expect(calls[1]).toMatchObject({
			redirect: 'manual',
			credentials: 'omit',
			headers: { range: 'bytes=0-0' }
		});
		expect(calls[1].headers).not.toHaveProperty('cookie');
		expect(cancel).toHaveBeenCalledOnce();
	});
	it('validates every redirect, follows relative targets and records only final success as redirected', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/next' } }))
			.mockResolvedValueOnce(new Response(null, { status: 200 }));
		expect(await probeLink(url, { resolveHost, fetcher })).toMatchObject({
			status: 'redirected',
			finalUrl: 'https://example.com/next'
		});
		expect(fetcher.mock.calls.map((call) => call[0])).toEqual([url, 'https://example.com/next']);
		const blocked = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } })
			);
		expect(await probeLink(url, { resolveHost, fetcher: blocked })).toMatchObject({
			status: 'blocked',
			reason: 'unsafe',
			finalUrl: url
		});
		expect(blocked).toHaveBeenCalledOnce();
	});
	it('rejects mixed/private DNS answers and unsafe addresses before any destination fetch', async () => {
		const fetcher = vi.fn<typeof fetch>();
		for (const target of [
			'http://127.0.0.1/',
			'https://user:password@example.com/',
			'https://example.com:8443/',
			'file:///etc/passwd'
		])
			expect(await probeLink(target, { resolveHost, fetcher })).toMatchObject({
				status: 'blocked',
				reason: 'unsafe'
			});
		expect(
			await probeLink(url, { resolveHost: async () => ['93.184.216.34', '10.0.0.1'], fetcher })
		).toMatchObject({ status: 'blocked' });
		expect(fetcher).not.toHaveBeenCalled();
	});
	it('uses bounded DNS A/AAAA lookups and rejects an empty DNS answer', async () => {
		const fetcher = vi.fn<typeof fetch>(async (input) =>
			String(input).includes('cloudflare-dns.com')
				? Response.json({ Status: 0, Answer: [] })
				: new Response()
		);
		expect(await probeLink(url, { fetcher })).toMatchObject({ status: 'uncertain', reason: 'dns' });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
	it('limits redirect chains and detects missing targets and loops', async () => {
		let hop = 0;
		const fetcher = vi.fn<typeof fetch>(
			async () => new Response(null, { status: 301, headers: { location: '/next-' + hop++ } })
		);
		expect(await probeLink(url, { resolveHost, fetcher })).toMatchObject({
			status: 'uncertain',
			reason: 'redirect-limit'
		});
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(
			await probeLink(url, {
				resolveHost,
				fetcher: async () => new Response(null, { status: 302 })
			})
		).toMatchObject({ reason: 'redirect-invalid' });
		expect(
			await probeLink(url, {
				resolveHost,
				fetcher: async () => new Response(null, { status: 302, headers: { location: url } })
			})
		).toMatchObject({ reason: 'redirect-loop' });
	});
	it('includes unresolved DNS and ignored aborts in the total timeout', async () => {
		const fetcher = vi.fn<typeof fetch>();
		expect(
			await probeLink(url, { fetcher, resolveHost: () => new Promise(() => {}), timeoutMs: 10 })
		).toMatchObject({ status: 'uncertain', reason: 'timeout' });
		expect(fetcher).not.toHaveBeenCalled();
		expect(
			await probeLink(url, { resolveHost, fetcher: () => new Promise(() => {}), timeoutMs: 10 })
		).toMatchObject({ reason: 'timeout' });
	});
	it('returns uncertainty for network errors and a non-fetching result for missing URLs', async () => {
		expect(
			await probeLink(url, {
				resolveHost,
				fetcher: async () => {
					throw new Error('private transport details');
				}
			})
		).toMatchObject({ status: 'uncertain', reason: 'network' });
		expect(await probeLink('', { resolveHost })).toMatchObject({
			status: 'blocked',
			reason: 'missing'
		});
	});
});
