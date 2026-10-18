import { assertPublicFetchTarget, WebFetchError } from './web-enrichment';
import type { LinkCheckResult } from '$lib/link-checks';

export type ProbeOptions = {
	fetcher?: typeof fetch;
	resolveHost?: (hostname: string) => Promise<string[]>;
	timeoutMs?: number;
};
class DnsError extends Error {}
class DeadlineError extends Error {}

// One deadline includes DNS, both HTTP methods and every redirect. No response body is read.
export async function probeLink(url: string, options: ProbeOptions = {}): Promise<LinkCheckResult> {
	const fetcher = options.fetcher ?? fetch,
		controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new DeadlineError());
		}, options.timeoutMs ?? 7_000);
	});
	const bounded = <T>(work: Promise<T>) => Promise.race([work, deadline]);
	const result: LinkCheckResult = {
		url,
		status: 'uncertain',
		httpStatus: null,
		finalUrl: null,
		reason: 'network',
		checkedAt: new Date().toISOString()
	};
	const resolveHost =
		options.resolveHost ??
		(async (hostname: string) => {
			const groups = await bounded(
				Promise.all(
					['A', 'AAAA'].map(async (type) => {
						const response = await fetcher(
							'https://cloudflare-dns.com/dns-query?' +
								new URLSearchParams({ name: hostname, type }),
							{
								signal: controller.signal,
								headers: { accept: 'application/dns-json' },
								redirect: 'error'
							}
						);
						if (!response.ok) {
							await response.body?.cancel();
							throw new DnsError();
						}
						const data = (await response.json()) as {
							Status?: number;
							Answer?: { type: number; data: string }[];
						};
						if (data.Status !== 0) throw new DnsError();
						return (data.Answer ?? [])
							.filter((answer) => [1, 28].includes(answer.type))
							.map((answer) => answer.data);
					})
				)
			);
			const addresses = groups.flat();
			if (!addresses.length) throw new DnsError();
			return addresses;
		});
	try {
		if (!url.trim()) return { ...result, status: 'blocked', reason: 'missing' };
		let current = url;
		const visited = new Set<string>();
		for (let hop = 0; hop <= 2; hop++) {
			current = await bounded(assertPublicFetchTarget(current, resolveHost));
			if (visited.has(current)) return { ...result, reason: 'redirect-loop' };
			visited.add(current);
			result.finalUrl = current;
			const request = async (method: 'HEAD' | 'GET') => {
				const response = await bounded(
					fetcher(current, {
						method,
						redirect: 'manual',
						credentials: 'omit',
						signal: controller.signal,
						headers: {
							'user-agent': 'NaviNest-LinkCheck/1.0',
							...(method === 'GET' ? { range: 'bytes=0-0' } : {})
						}
					})
				);
				await bounded(response.body?.cancel().catch(() => undefined) ?? Promise.resolve());
				return response;
			};
			let response = await request('HEAD');
			if ([405, 501].includes(response.status)) response = await request('GET');
			result.httpStatus = response.status;
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				if (hop === 2) return { ...result, reason: 'redirect-limit' };
				const location = response.headers.get('location');
				if (!location) return { ...result, reason: 'redirect-invalid' };
				try {
					current = new URL(location, current).href;
				} catch {
					return { ...result, reason: 'redirect-invalid' };
				}
				continue;
			}
			if ([404, 410].includes(response.status))
				return { ...result, status: 'gone', reason: 'http' };
			if (response.ok) return { ...result, status: hop ? 'redirected' : 'reachable', reason: 'ok' };
			return { ...result, reason: 'http' };
		}
		return { ...result, reason: 'redirect-limit' };
	} catch (error) {
		if (error instanceof DeadlineError || controller.signal.aborted)
			return { ...result, reason: 'timeout' };
		if (
			error instanceof DnsError ||
			(error instanceof WebFetchError && error.message === '目标域名无法解析。')
		)
			return { ...result, reason: 'dns' };
		if (error instanceof WebFetchError) return { ...result, status: 'blocked', reason: 'unsafe' };
		return result;
	} finally {
		clearTimeout(timer!);
		controller.abort();
	}
}
