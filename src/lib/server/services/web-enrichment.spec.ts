import { describe, expect, it, vi } from 'vitest';
import { WebFetchError, fetchWebSnapshot } from '$lib/server/services/web-enrichment';

const publicDns = async () => ['93.184.216.34'];

describe('safe web enrichment', () => {
	it('extracts canonical metadata and readable text from a public HTML page', async () => {
		const fetcher = vi.fn(
			async () =>
				new Response(
					`<!doctype html><html><head><title>A Very Long Example Product Title</title><meta property="og:description" content="A useful product for focused teams"><meta property="og:site_name" content="Example"><link rel="icon" href="/assets/favicon.png"></head><body><nav>Skip navigation</nav><main><h1>Example Product</h1><p>This is the primary readable content for visitors.</p><script>ignore()</script></main></body></html>`,
					{ headers: { 'content-type': 'text/html; charset=utf-8' } }
				)
		);
		const result = await fetchWebSnapshot('https://example.com/start', {
			fetcher,
			resolveHost: publicDns
		});
		expect(result).toMatchObject({
			fetchedUrl: 'https://example.com/start',
			title: 'A Very Long Example Product Title',
			description: 'A useful product for focused teams',
			siteName: 'Example',
			iconUrl: 'https://example.com/assets/favicon.png'
		});
		expect(result.excerpt).toContain('This is the primary readable content');
		expect(result.excerpt).not.toContain('ignore()');
	});

	it.each([
		'http://localhost/admin',
		'http://127.0.0.1/',
		'http://[::1]/',
		'http://user:secret@example.com/',
		'file:///etc/passwd'
	])('rejects unsafe target %s', async (url) => {
		await expect(
			fetchWebSnapshot(url, { fetcher: fetch, resolveHost: publicDns })
		).rejects.toBeInstanceOf(WebFetchError);
	});

	it('rejects public hostnames resolving to private addresses', async () => {
		await expect(
			fetchWebSnapshot('https://example.com', {
				fetcher: fetch,
				resolveHost: async () => ['10.0.0.8']
			})
		).rejects.toThrow('私网');
	});

	it('revalidates redirects and refuses redirects into private networks', async () => {
		const fetcher = vi.fn(
			async () =>
				new Response(null, {
					status: 302,
					headers: { location: 'http://169.254.169.254/latest/meta-data' }
				})
		);
		await expect(
			fetchWebSnapshot('https://example.com', { fetcher, resolveHost: publicDns })
		).rejects.toThrow('私网');
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('rejects non-HTML responses and caps extracted content', async () => {
		await expect(
			fetchWebSnapshot('https://example.com/file.pdf', {
				fetcher: async () =>
					new Response('pdf', { headers: { 'content-type': 'application/pdf' } }),
				resolveHost: publicDns
			})
		).rejects.toThrow('HTML');
		const result = await fetchWebSnapshot('https://example.com/long', {
			fetcher: async () =>
				new Response(`<html><title>Long</title><body>${'word '.repeat(5000)}</body></html>`, {
					headers: { 'content-type': 'text/html' }
				}),
			resolveHost: publicDns,
			maxTextChars: 500
		});
		expect(result.excerpt.length).toBeLessThanOrEqual(500);
	});

	it('ignores non-http icon declarations and falls back to the same-origin favicon', async () => {
		const result = await fetchWebSnapshot('https://example.com/page', {
			resolveHost: publicDns,
			fetcher: async () =>
				new Response(
					'<html><head><title>Example</title><link rel="icon" href="data:,"></head><body>Content</body></html>',
					{ headers: { 'content-type': 'text/html' } }
				)
		});
		expect(result.iconUrl).toBe('https://example.com/favicon.ico');
	});
});
