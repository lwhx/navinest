import { validateExternalTarget } from '$lib/server/safe-target';
export type HotFetchConfig = {
	type: 'json' | 'rss' | 'html';
	url: string;
	headers: Record<string, string>;
	parser: Record<string, string>;
};
export function validateHotSourceFetchInput(input: Record<string, unknown>) {
	const errors: Record<string, string> = {},
		type = ['json', 'rss', 'html'].includes(String(input.type))
			? (input.type as HotFetchConfig['type'])
			: null;
	if (!type) errors.type = '类型必须是 JSON、RSS 或 HTML。';
	const target = validateExternalTarget(typeof input.url === 'string' ? input.url.trim() : '');
	if (!target.valid) errors.url = '请输入有效的公网 HTTP/HTTPS 地址。';
	const object = (value: unknown, key: string, max: number) => {
		try {
			if (value !== undefined && typeof value !== 'string') throw new Error();
			if (typeof value === 'string' && value.length > max) throw new Error();
			const parsed = typeof value === 'string' && value.trim() ? JSON.parse(value) : {};
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
			return parsed as Record<string, unknown>;
		} catch {
			errors[key] = '请输入有效且大小合适的 JSON 对象。';
			return {};
		}
	};
	const headers: Record<string, string> = {},
		rawHeaders = object(input.headersJson, 'headersJson', 16000);
	if (Object.keys(rawHeaders).length > 20) errors.headersJson = '请求头最多 20 项。';
	for (const [key, value] of Object.entries(rawHeaders)) {
		if (
			['authorization', 'cookie', 'proxy-authorization', 'x-api-key'].includes(key.toLowerCase()) ||
			typeof value !== 'string' ||
			key.length > 100 ||
			value.length > 1000
		) {
			errors.headersJson = '请求头不能包含凭据，且键值必须为字符串。';
			break;
		}
		try {
			new Headers({ [key]: value });
			headers[key] = value;
		} catch {
			errors.headersJson = '请求头名称或内容无效。';
		}
	}
	const parser: Record<string, string> = {},
		rawParser = object(input.parserJson, 'parserJson', 4000),
		keys =
			type === 'html'
				? ['itemSelector', 'titleSelector', 'hotSelector', 'baseUrl']
				: ['itemsPath', 'titleField', 'urlField', 'hotField'];
	for (const [key, value] of Object.entries(rawParser)) {
		if (
			!keys.includes(key) ||
			typeof value !== 'string' ||
			value.length > (key === 'baseUrl' ? 200 : 100)
		) {
			errors.parserJson =
				type === 'html'
					? 'HTML 解析配置仅支持 itemSelector、titleSelector、hotSelector 与 baseUrl。'
					: '解析配置字段无效。';
			break;
		}
		if (value) parser[key] = value;
	}
	if (type === 'html') {
		if (!parser.itemSelector) errors.parserJson = 'HTML 榜单必须配置 itemSelector。';
		for (const key of ['itemSelector', 'titleSelector', 'hotSelector'])
			if (parser[key] && !/^([a-z][a-z0-9-]*)?((?:\.[a-z0-9_-]+)*)$/i.test(parser[key].trim()))
				errors.parserJson = 'HTML 选择器仅支持 tag、.class 或 tag.class。';
		if (parser.baseUrl && !validateExternalTarget(parser.baseUrl).valid)
			errors.parserJson = 'HTML 基准地址必须是有效的公网 HTTP/HTTPS 地址。';
	}
	return Object.keys(errors).length
		? { valid: false as const, errors }
		: {
				valid: true as const,
				data: { type: type!, url: target.valid ? target.target : '', headers, parser }
			};
}
