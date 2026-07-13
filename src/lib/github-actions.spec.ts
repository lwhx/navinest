import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (name: string) => readFileSync(`.github/workflows/${name}`, 'utf8');
describe('GitHub Actions quality gates', () => {
	it('runs deterministic code quality gates and protects the worker entrypoint', () => {
		const workflow = read('quality.yml');
		for (const value of [
			'actions/checkout@v4',
			'actions/setup-node@v4',
			'node-version: 22',
			'cache: npm',
			'npm ci',
			'npm run lint',
			'npm run check',
			'npm run test',
			'npm run build',
			'sha256sum cloudflare/worker.ts'
		])
			expect(workflow).toContain(value);
		expect(workflow).not.toContain('wrangler deploy');
	});
	it('runs anonymous read-only production smoke on schedule and manually', () => {
		const workflow = read('production-smoke.yml');
		for (const value of [
			'schedule:',
			'workflow_dispatch:',
			'contents: read',
			'npm ci',
			'playwright install --with-deps chromium',
			'npm run --silent smoke:production',
			'actions/upload-artifact@v4'
		])
			expect(workflow).toContain(value);
		expect(workflow).not.toMatch(/CLOUDFLARE|GITHUB_TOKEN|wrangler deploy|cf-access-client/i);
	});
});
