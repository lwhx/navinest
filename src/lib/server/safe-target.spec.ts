import { describe, expect, it } from 'vitest';
import { validateExternalTarget } from '$lib/server/safe-target';

describe('external target validation', () => {
	it('accepts public HTTP and HTTPS URLs', () => {
		expect(validateExternalTarget('https://example.com/docs?q=nav')).toEqual({
			valid: true,
			target: 'https://example.com/docs?q=nav',
			host: 'example.com'
		});
		expect(validateExternalTarget('http://github.com')).toMatchObject({ valid: true });
	});

	it('rejects non-web protocols and embedded credentials', () => {
		expect(validateExternalTarget('javascript:alert(1)')).toMatchObject({ valid: false });
		expect(validateExternalTarget('https://user:secret@example.com')).toMatchObject({
			valid: false
		});
	});

	it('rejects local, private and reserved network targets', () => {
		for (const target of [
			'http://localhost:8787',
			'http://127.0.0.1',
			'http://10.0.0.2',
			'http://192.168.1.10',
			'http://169.254.169.254',
			'http://[::1]'
		]) {
			expect(validateExternalTarget(target)).toMatchObject({ valid: false });
		}
	});

	it('rejects malformed targets and control characters', () => {
		expect(validateExternalTarget('not a url')).toMatchObject({ valid: false });
		expect(validateExternalTarget('https://example.com/\nheader')).toMatchObject({ valid: false });
	});
});
