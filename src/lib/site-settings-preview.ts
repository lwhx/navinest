import { validateExternalTarget } from '$lib/safe-target';

/** A preview must never turn a protocol-relative or backslash URL into a local link. */
export function announcementTarget(value: string): string | null {
	const raw = value.trim();
	if (!raw) return '';
	if (
		raw.includes('\\') ||
		Array.from(raw).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
	)
		return null;
	if (raw.startsWith('/')) return raw.startsWith('//') ? null : raw;
	const result = validateExternalTarget(raw);
	return result.valid ? result.target : null;
}
