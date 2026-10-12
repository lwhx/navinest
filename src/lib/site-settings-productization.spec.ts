import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adminNavigation } from '$lib/admin-navigation';

const read = (path: string) => readFileSync(path, 'utf8');

describe('site settings productization', () => {
	it('loads settings in the root layout and exposes them to components', () => {
		expect(read('src/routes/+layout.server.ts')).toContain(
			'site: await loadSiteSettings(getDatabase(platform))'
		);
		const layout = read('src/routes/+layout.svelte');
		expect(layout).toContain('provideSiteSettings(() => site)');
		expect(layout).toContain('site.announcementEnabled');
		expect(layout).toContain('navinest-announcement:');
		expect(read('src/lib/site-context.ts')).toContain('useSiteSettings');
	});

	it('drives public branding from settings instead of constants', () => {
		const shell = read('src/lib/components/PublicShell.svelte');
		expect(shell).toContain('useSiteSettings');
		expect(shell).toContain('site().siteName');
		expect(shell).toContain('site().siteDescription');
		expect(read('src/routes/+page.svelte')).toContain('data.site.siteDescription');
		expect(read('src/routes/+error.svelte')).toContain('siteDisplayName(site())');
	});

	it('honours the sitemap switch and robots additions', () => {
		const sitemap = read('src/routes/sitemap.xml/+server.ts');
		expect(sitemap).toContain('site.sitemapEnabled');
		expect(sitemap).toContain('status: 404');
		const robots = read('src/routes/robots.txt/+server.ts');
		expect(robots).toContain('site.robotsExtra');
		expect(robots).toContain('site.sitemapEnabled');
	});

	it('gates contributions on the submissions switch', () => {
		expect(read('src/routes/contribute/+page.server.ts')).toContain('submissionsOpen');
		expect(read('src/routes/contribute/+page.svelte')).toContain('{#if data.submissionsOpen}');
		for (const path of [
			'src/routes/api/submissions/+server.ts',
			'src/routes/api/submissions/enrich/+server.ts'
		])
			expect(read(path)).toContain('投稿通道已关闭');
	});

	it('ships an admin page, API and navigation entry', () => {
		expect(existsSync('src/routes/admin/settings/+page.svelte')).toBe(true);
		expect(read('src/routes/admin/settings/+page.server.ts')).toContain(
			'validateSiteSettingsInput'
		);
		expect(read('src/routes/admin/settings/+page.svelte')).toContain('name="announcementEnabled"');
		const api = read('src/routes/api/admin/settings/+server.ts');
		expect(api).toContain('export const GET');
		expect(api).toContain('export const PUT');
		expect(
			adminNavigation.some((group) => group.items.some((item) => item.href === '/admin/settings'))
		).toBe(true);
		expect(read('src/routes/admin/+layout.svelte')).toContain('adminNavigation');
	});
});
