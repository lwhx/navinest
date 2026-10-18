import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('public registration wiring', () => {
	it('ships a register page guarded by the settings switch', () => {
		expect(existsSync('src/routes/register/+page.svelte')).toBe(true);
		const server = read('src/routes/register/+page.server.ts');
		expect(server).toContain('registrationOpen');
		expect(server).toContain('registerUser');
		expect(server).toContain('setSessionCookie');
		expect(read('src/routes/register/+page.svelte')).toContain('{#if !data.registrationOpen}');
	});

	it('closes the registration API when the switch is off', () => {
		const api = read('src/routes/api/auth/register/+server.ts');
		expect(api).toContain('registrationOpen');
		expect(api).toContain('status: 403');
		expect(api).toContain('validateRegistrationInput');
	});

	it('only links to registration from the login page when it is open', () => {
		expect(read('src/routes/login/+page.server.ts')).toContain('registrationOpen');
		expect(read('src/routes/login/+page.svelte')).toContain('{#if data.registrationOpen}');
		expect(read('src/routes/login/+page.svelte')).toContain("resolve('/register')");
	});

	it('treats /register as a private no-store surface', () => {
		expect(read('src/lib/server/security-headers.ts')).toContain("pathname === '/register'");
	});

	it('exposes the switch in site settings', () => {
		expect(read('src/lib/types/site.ts')).toContain('registrationOpen: false');
		expect(read('src/lib/server/services/site-settings.ts')).toContain('registrationOpen');
	});
});
