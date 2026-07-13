const PASSWORD_ALGORITHM = 'PBKDF2';
const PASSWORD_DIGEST = 'SHA-256';
const SEGMENT_ITERATIONS = 70_000;
const SEGMENT_COUNT = 3;

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array | null {
	try {
		const padded = value
			.replace(/-/g, '+')
			.replace(/_/g, '/')
			.padEnd(Math.ceil(value.length / 4) * 4, '=');
		return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		PASSWORD_ALGORITHM,
		false,
		['deriveBits']
	);
	const normalizedSalt = new Uint8Array(salt);
	const bits = await crypto.subtle.deriveBits(
		{ name: PASSWORD_ALGORITHM, hash: PASSWORD_DIGEST, salt: normalizedSalt, iterations },
		key,
		256
	);
	return new Uint8Array(bits);
}

async function deriveSegmentedPassword(password: string, salt: Uint8Array) {
	const segments: Uint8Array[] = [];
	for (let index = 0; index < SEGMENT_COUNT; index += 1) {
		const segmentSalt = new Uint8Array(salt.length + 1);
		segmentSalt.set(salt);
		segmentSalt[salt.length] = index;
		segments.push(await derivePassword(password, segmentSalt, SEGMENT_ITERATIONS));
	}
	const combined = new Uint8Array(segments.length * 32);
	segments.forEach((segment, index) => combined.set(segment, index * 32));
	return new Uint8Array(await crypto.subtle.digest('SHA-256', combined));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
	return difference === 0;
}

export async function createPasswordHash(
	password: string,
	options: { salt?: Uint8Array; iterations?: number } = {}
): Promise<string> {
	const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
	const iterations = options.iterations;
	if (iterations === undefined) {
		if (salt.length < 16) throw new Error('Invalid password hashing parameters.');
		const derived = await deriveSegmentedPassword(password, salt);
		return `pbkdf2-sha256-segmented$${SEGMENT_ITERATIONS}$${SEGMENT_COUNT}$${base64UrlEncode(salt)}$${base64UrlEncode(derived)}`;
	}
	if (iterations < 1 || salt.length < 16) throw new Error('Invalid password hashing parameters.');
	const derived = await derivePassword(password, salt, iterations);
	return `pbkdf2-sha256$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(derived)}`;
}

export async function verifyPasswordHash(password: string, encoded: string): Promise<boolean> {
	if (encoded.startsWith('pbkdf2-sha256-segmented$')) {
		const [scheme, iterationsText, countText, saltText, digestText, extra] = encoded.split('$');
		const salt = base64UrlDecode(saltText ?? '');
		const expected = base64UrlDecode(digestText ?? '');
		if (
			scheme !== 'pbkdf2-sha256-segmented' ||
			Number(iterationsText) !== SEGMENT_ITERATIONS ||
			Number(countText) !== SEGMENT_COUNT ||
			extra !== undefined ||
			!salt ||
			salt.length < 16 ||
			!expected
		)
			return false;
		try {
			return equalBytes(await deriveSegmentedPassword(password, salt), expected);
		} catch {
			return false;
		}
	}
	const [scheme, iterationsText, saltText, digestText, extra] = encoded.split('$');
	const iterations = Number(iterationsText);
	const salt = base64UrlDecode(saltText ?? '');
	const expected = base64UrlDecode(digestText ?? '');
	if (scheme !== 'pbkdf2-sha256' || extra !== undefined) return false;
	if (!Number.isInteger(iterations) || iterations < 1 || !salt || salt.length < 16 || !expected)
		return false;
	try {
		return equalBytes(await derivePassword(password, salt, iterations), expected);
	} catch {
		return false;
	}
}

export function createSessionToken(bytes = crypto.getRandomValues(new Uint8Array(32))): string {
	if (bytes.length < 32) throw new Error('Session tokens require at least 32 random bytes.');
	return base64UrlEncode(bytes);
}

export async function hashSessionToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return base64UrlEncode(new Uint8Array(digest));
}

export function normalizeLoginIdentifier(value: string): string {
	return value.trim().toLowerCase();
}
