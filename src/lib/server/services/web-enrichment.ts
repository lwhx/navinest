import { validateExternalTarget } from '$lib/server/safe-target';

export type WebSnapshot = {
	fetchedUrl: string;
	title: string;
	description: string;
	excerpt: string;
	siteName: string;
	fetchedAt: string;
};

type FetchOptions = {
	fetcher?: typeof fetch;
	resolveHost?: (hostname: string) => Promise<string[]>;
	maxTextChars?: number;
	maxBytes?: number;
	timeoutMs?: number;
	maxRedirects?: number;
};

export class WebFetchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WebFetchError';
	}
}

function decode(value: string): string {
	return value
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function text(value: string): string {
	return decode(value.replace(/<[^>]*>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
}

function attribute(tag: string, name: string): string {
	const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
	return match?.[2]?.trim() ?? '';
}

function metadata(html: string, names: string[]): string {
	for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
		const key = (attribute(tag, 'property') || attribute(tag, 'name')).toLowerCase();
		if (names.includes(key)) return decode(attribute(tag, 'content')).replace(/\s+/g, ' ').trim();
	}
	return '';
}

function readableHtml(html: string): string {
	const cleaned = html
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(
			/<(script|style|noscript|svg|canvas|nav|footer|header|form|aside)\b[\s\S]*?<\/\1>/gi,
			' '
		);
	return (
		cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
		cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
		cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
		cleaned
	);
}

async function readLimited(response: Response, limit: number): Promise<string> {
	if (!response.body) return '';
	const reader = response.body.getReader(),
		chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		const remaining = limit - size;
		if (remaining <= 0) {
			await reader.cancel();
			break;
		}
		chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
		size += Math.min(value.length, remaining);
		if (size >= limit) {
			await reader.cancel();
			break;
		}
	}
	const combined = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.length;
	}
	return new TextDecoder().decode(combined);
}

function addressUrl(address: string): string {
	return address.includes(':') ? `http://[${address}]/` : `http://${address}/`;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
	const addresses: string[] = [];
	for (const type of ['A', 'AAAA']) {
		const response = await fetch(
			`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
			{ headers: { accept: 'application/dns-json' } }
		);
		if (!response.ok) continue;
		const body = (await response.json()) as { Answer?: Array<{ data?: string }> };
		for (const answer of body.Answer ?? []) if (answer.data) addresses.push(answer.data);
	}
	return addresses;
}

export async function assertPublicFetchTarget(
	url: string,
	resolveHost: (hostname: string) => Promise<string[]> = defaultResolveHost
) {
	const result = validateExternalTarget(url);
	if (!result.valid) throw new WebFetchError(result.reason);
	const parsed = new URL(result.target);
	if (parsed.port && !['80', '443'].includes(parsed.port))
		throw new WebFetchError('仅允许访问标准 HTTP 或 HTTPS 端口。');
	const addresses = await resolveHost(parsed.hostname);
	if (!addresses.length) throw new WebFetchError('目标域名无法解析。');
	for (const address of addresses) {
		const check = validateExternalTarget(addressUrl(address));
		if (!check.valid) throw new WebFetchError('目标域名解析到本机、私网或保留地址。');
	}
	return result.target;
}

export async function fetchWebSnapshot(
	input: string,
	options: FetchOptions = {}
): Promise<WebSnapshot> {
	const fetcher = options.fetcher ?? fetch,
		resolveHost = options.resolveHost ?? defaultResolveHost,
		maxTextChars = Math.max(100, Math.min(options.maxTextChars ?? 8_000, 30_000)),
		maxBytes = Math.max(1024, Math.min(options.maxBytes ?? 2_000_000, 5_000_000)),
		maxRedirects = Math.max(0, Math.min(options.maxRedirects ?? 4, 8));
	let current = input;
	for (let redirect = 0; redirect <= maxRedirects; redirect++) {
		current = await assertPublicFetchTarget(current, resolveHost);
		const controller = new AbortController(),
			timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
		let response: Response;
		try {
			response = await fetcher(current, {
				redirect: 'manual',
				signal: controller.signal,
				headers: {
					accept: 'text/html,application/xhtml+xml;q=0.9',
					'user-agent': 'NaviNest-LinkPreview/1.0'
				}
			});
		} catch {
			throw new WebFetchError('网页抓取失败或请求超时。');
		} finally {
			clearTimeout(timer);
		}
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			if (!location) throw new WebFetchError('网页重定向缺少目标地址。');
			if (redirect === maxRedirects) throw new WebFetchError('网页重定向次数过多。');
			current = new URL(location, current).href;
			continue;
		}
		if (!response.ok) throw new WebFetchError(`网页返回了 ${response.status} 状态。`);
		const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
		if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml'))
			throw new WebFetchError('目标不是可解析的 HTML 网页。');
		const html = await readLimited(response, maxBytes),
			title =
				metadata(html, ['og:title', 'twitter:title']) ||
				text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
			description = metadata(html, ['og:description', 'twitter:description', 'description']),
			siteName = metadata(html, ['og:site_name']),
			excerpt = text(readableHtml(html)).slice(0, maxTextChars);
		if (!title && !description && !excerpt) throw new WebFetchError('网页没有可提取的文本内容。');
		return {
			fetchedUrl: current,
			title,
			description,
			excerpt,
			siteName,
			fetchedAt: new Date().toISOString()
		};
	}
	throw new WebFetchError('网页重定向次数过多。');
}
