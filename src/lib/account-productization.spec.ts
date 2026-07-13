import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(path, 'utf8');
describe('account productization', () => {
	it('provides a shared account shell with account navigation', () => {
		const shell = read('src/lib/components/AccountShell.svelte');
		expect(shell).toContain('<PublicShell');
		expect(shell).toContain('account-subnav');
		for (const href of ['/user', '/user/submissions', '/user/messages', '/contribute'])
			expect(shell).toContain(`resolve('${href}')`);
	});
	it('uses the shared shell across account, contribution and authentication pages', () => {
		for (const path of [
			'src/routes/user/+page.svelte',
			'src/routes/user/submissions/+page.svelte',
			'src/routes/user/messages/+page.svelte',
			'src/routes/contribute/+page.svelte',
			'src/routes/login/+page.svelte'
		])
			expect(read(path)).toContain('<AccountShell');
	});
	it('retains user business actions and safe outbound submission links', () => {
		expect(read('src/routes/user/+page.svelte')).toContain("fetch('/api/user/profile'");
		expect(read('src/routes/contribute/+page.svelte')).toContain("fetch('/api/submissions'");
		expect(read('src/routes/user/submissions/+page.svelte')).toContain('/go?url=');
		expect(read('src/routes/login/+page.svelte')).toContain('/api/auth/github');
	});
});
