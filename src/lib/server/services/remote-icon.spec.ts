import { describe, expect, it, vi } from 'vitest';
import { RemoteIconError, fetchRemoteIcon } from '$lib/server/services/remote-icon';

const publicDns = async () => ['93.184.216.34'];

describe('remote icon fetch', () => {
	it('downloads a small public raster icon', async () => {
		const fetcher = vi.fn(
			async () =>
				new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
		);
		const file = await fetchRemoteIcon('https://example.com/icon.png', {
			fetcher,
			resolveHost: publicDns
		});
		expect(file).toMatchObject({ name: 'remote-icon.png', type: 'image/png', size: 3 });
	});

	it('rejects HTML, SVG, oversized files, and redirects to private targets', async () => {
		await expect(
			fetchRemoteIcon('https://example.com/icon', {
				fetcher: async () =>
					new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
				resolveHost: publicDns
			})
		).rejects.toBeInstanceOf(RemoteIconError);
		await expect(
			fetchRemoteIcon('https://example.com/icon.svg', {
				fetcher: async () =>
					new Response('<svg></svg>', { headers: { 'content-type': 'image/svg+xml' } }),
				resolveHost: publicDns
			})
		).rejects.toThrow('SVG');
		await expect(
			fetchRemoteIcon('https://example.com/huge.png', {
				fetcher: async () =>
					new Response(new Uint8Array(1024 * 1024 + 1), {
						headers: { 'content-type': 'image/png' }
					}),
				resolveHost: publicDns
			})
		).rejects.toThrow('1 MiB');
		await expect(
			fetchRemoteIcon('https://example.com/start', {
				fetcher: async () =>
					new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/icon.png' } }),
				resolveHost: async (host) => (host === 'example.com' ? ['93.184.216.34'] : ['127.0.0.1'])
			})
		).rejects.toBeInstanceOf(RemoteIconError);
	});
});
