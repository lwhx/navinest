import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Use the runtime and bundler shipped with the installed Wrangler, including nested installs.
const wranglerRequire = createRequire(import.meta.resolve('wrangler/package.json'));
const { build } = wranglerRequire('esbuild');
const { Miniflare, createFetchMock } = wranglerRequire('miniflare');
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const bundled = await build({
	stdin: {
		contents: `import { probeLink } from './src/lib/server/services/link-probe.ts';
			export default { async fetch(request) {
				return Response.json(await probeLink(new URL(request.url).searchParams.get('target')));
			} };`,
		resolveDir: process.cwd()
	},
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'browser',
	alias: { $lib: resolve('src/lib') }
});

// Real Worker Request/fetch semantics, deterministic upstream responses, no external requests.
const fetchMock = createFetchMock();
fetchMock.disableNetConnect();
for (const type of ['A', 'AAAA']) {
	fetchMock
		.get('https://cloudflare-dns.com')
		.intercept({ path: '/dns-query?name=example.com&type=' + type })
		.reply(
			200,
			JSON.stringify({
				Status: 0,
				Answer: type === 'A' ? [{ type: 1, data: '93.184.216.34' }] : []
			})
		);
	fetchMock
		.get('https://cloudflare-dns.com')
		.intercept({ path: '/dns-query?name=redirected.example&type=' + type })
		.reply(302, '', { headers: { location: 'http://127.0.0.1/private-dns' } });
}
fetchMock.get('https://example.com').intercept({ path: '/start', method: 'HEAD' }).reply(200);
const worker = new Miniflare({
	modules: true,
	script: bundled.outputFiles[0].text,
	compatibilityDate: config.compatibility_date,
	compatibilityFlags: config.compatibility_flags,
	fetchMock
});
try {
	const probe = async (target) =>
		(await worker.dispatchFetch('http://local/?' + new URLSearchParams({ target }))).json();
	const reachable = await probe('https://example.com/start');
	assert.equal(reachable.status, 'reachable', JSON.stringify(reachable));
	assert.equal(reachable.httpStatus, 200);
	const redirectedDns = await probe('https://redirected.example/start');
	assert.equal(redirectedDns.reason, 'dns', JSON.stringify(redirectedDns));
	assert.equal(redirectedDns.finalUrl, null);
	fetchMock.assertNoPendingInterceptors();
	console.log('Worker link probes: public DNS/HEAD success and DNS redirect rejection passed.');
} finally {
	await worker.dispose();
}
