export type SafeTargetResult =
	| { valid: true; target: string; host: string }
	| { valid: false; target: null; host: null; reason: string };

function isNonPublicIpv4(hostname: string): boolean {
	const parts = hostname.split('.');
	if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;

	const octets = parts.map(Number);
	if (octets.some((octet) => octet < 0 || octet > 255)) return true;
	const [a, b, c] = octets;

	return Boolean(
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0 && (c === 0 || c === 2)) ||
		(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	);
}

function isNonPublicHostname(hostname: string): boolean {
	const normalized = hostname
		.toLowerCase()
		.replace(/^\[|\]$/g, '')
		.replace(/\.$/, '');
	if (!normalized) return true;

	if (
		normalized === 'localhost' ||
		normalized.endsWith('.localhost') ||
		normalized.endsWith('.local') ||
		normalized.endsWith('.internal') ||
		normalized.endsWith('.lan') ||
		normalized.endsWith('.home')
	) {
		return true;
	}

	if (isNonPublicIpv4(normalized)) return true;

	return (
		normalized === '::' ||
		normalized === '::1' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		/^fe[89ab]/.test(normalized) ||
		normalized.startsWith('::ffff:')
	);
}

export function validateExternalTarget(input: string): SafeTargetResult {
	const value = input.trim();
	if (!value) return { valid: false, target: null, host: null, reason: '缺少目标地址。' };
	if (value.length > 2048)
		return { valid: false, target: null, host: null, reason: '目标地址过长。' };
	if (
		[...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
	)
		return { valid: false, target: null, host: null, reason: '目标地址包含非法字符。' };

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { valid: false, target: null, host: null, reason: '目标地址格式无效。' };
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return { valid: false, target: null, host: null, reason: '仅允许访问 HTTP 或 HTTPS 地址。' };
	}

	if (url.username || url.password) {
		return { valid: false, target: null, host: null, reason: '不允许访问包含账号凭据的地址。' };
	}

	if (isNonPublicHostname(url.hostname)) {
		return { valid: false, target: null, host: null, reason: '不允许访问本机、私网或保留地址。' };
	}

	return { valid: true, target: url.href, host: url.host };
}
