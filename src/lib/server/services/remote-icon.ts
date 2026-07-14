import { assertPublicFetchTarget, WebFetchError } from '$lib/server/services/web-enrichment';

const MIME_EXTENSIONS = new Map([
	['image/jpeg', 'jpg'],
	['image/png', 'png'],
	['image/webp', 'webp'],
	['image/gif', 'gif'],
	['image/x-icon', 'ico'],
	['image/vnd.microsoft.icon', 'ico']
]);

export class RemoteIconError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RemoteIconError';
	}
}

type Options = {
	fetcher?: typeof fetch;
	resolveHost?: (hostname: string) => Promise<string[]>;
	timeoutMs?: number;
	maxBytes?: number;
};

async function bytes(response: Response, maximum: number) {
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader(),
		chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		size += value.length;
		if (size > maximum) {
			await reader.cancel();
			throw new RemoteIconError('网站图标不能超过 1 MiB。');
		}
		chunks.push(value);
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

export async function fetchRemoteIcon(input: string, options: Options = {}) {
	const fetcher = options.fetcher ?? fetch,
		resolveHost = options.resolveHost,
		maximum = Math.min(options.maxBytes ?? 1024 * 1024, 1024 * 1024);
	let current = input;
	for (let redirect = 0; redirect <= 3; redirect++) {
		try {
			current = await assertPublicFetchTarget(current, resolveHost);
		} catch (error) {
			throw new RemoteIconError(
				error instanceof WebFetchError ? error.message : '网站图标地址无效。'
			);
		}
		const controller = new AbortController(),
			timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6000);
		let response: Response;
		try {
			response = await fetcher(current, {
				redirect: 'manual',
				signal: controller.signal,
				headers: {
					accept: 'image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon'
				}
			});
		} catch {
			throw new RemoteIconError('网站图标下载失败或超时。');
		} finally {
			clearTimeout(timer);
		}
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			if (!location || redirect === 3) throw new RemoteIconError('网站图标重定向无效或次数过多。');
			current = new URL(location, current).href;
			continue;
		}
		if (!response.ok) throw new RemoteIconError(`网站图标返回了 ${response.status} 状态。`);
		const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
		if (mime === 'image/svg+xml')
			throw new RemoteIconError('自动抓取不接受 SVG 图标，请手动上传可信图片。');
		const extension = MIME_EXTENSIONS.get(mime);
		if (!extension) throw new RemoteIconError('远程文件不是支持的安全图片格式。');
		const body = await bytes(response, maximum);
		if (!body.length) throw new RemoteIconError('网站图标文件为空。');
		return new File([body], `remote-icon.${extension}`, { type: mime });
	}
	throw new RemoteIconError('网站图标重定向次数过多。');
}
