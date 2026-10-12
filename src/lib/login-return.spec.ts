import { describe, expect, it } from 'vitest';
import { adminLoginReturnTo } from '$lib/login-return';

describe('administrator login return target', () => {
	it('preserves admin pages and their query without returning to an external host', () => {
		for (const path of ['/admin', '/admin/items?type=site&query=中文%20资源'])
			expect(new URL(adminLoginReturnTo(path), 'https://nss.whks.de').href).toBe(
				new URL(path, 'https://nss.whks.de').href
			);
		expect(adminLoginReturnTo('/admin/users#old')).toBe('/admin/users');
	});
	it.each([
		null,
		'',
		'https://evil.example/admin',
		'//evil.example/admin',
		'/\\evil.example/admin',
		'/admin/%5cevil',
		'/admin\n',
		'/admin?x=%0d%0a',
		'/admin?x=%7f',
		'/admin/%',
		'/admin/../../login',
		'/administrator',
		'/api/admin/users',
		'/login?returnTo=/admin',
		'/admin?' + 'a'.repeat(2048)
	])('uses the homepage for an unsafe or unsupported target: %s', (value) => {
		expect(adminLoginReturnTo(value)).toBe('/');
	});
});
