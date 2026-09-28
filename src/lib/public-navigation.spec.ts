import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public navigation completion', () => {
	it('renders a full footer and mobile tabbar from the shared shell', () => {
		const shell = readFileSync('src/lib/components/PublicShell.svelte', 'utf8');
		expect(shell).toContain('public-footer-grid');
		expect(shell).toContain('mobile-tabbar');
		expect(shell).toContain('友情链接');
	});
	it('uses one desktop navigation and marks the current route in every visible navigation', () => {
		const shell = readFileSync('src/lib/components/PublicShell.svelte', 'utf8');
		expect(shell).not.toContain('class="public-sidebar"');
		expect(shell).toContain("import { page } from '$app/state'");
		expect(shell).toContain("aria-current={isCurrent(link.href) ? 'page' : undefined}");
		expect(shell).toContain('class:active={isCurrent(link.href)}');
		expect(shell).toContain('auxiliaryLinks');
		expect(shell).toContain("resolve('/robots.txt')");
	});
	it('locks document scrolling while either mobile drawer is open', () => {
		const shell = readFileSync('src/lib/components/PublicShell.svelte', 'utf8');
		const home = readFileSync('src/routes/+page.svelte', 'utf8');
		for (const source of [shell, home]) {
			expect(source).toContain("document.documentElement.style.overflow = 'hidden'");
			expect(source).toContain("document.body.style.overflow = 'hidden'");
			expect(source).toContain("event.key === 'Escape'");
		}
	});
	it('provides 44px mobile targets for menus, cards and the persistent tabbar', () => {
		const shellCss = readFileSync('src/lib/components/public-shell.css', 'utf8');
		const contentCss = readFileSync('src/lib/components/public-content.css', 'utf8');
		const navigationCss = readFileSync('src/lib/components/public-navigation.css', 'utf8');
		const homeDrawerCss = readFileSync('src/routes/benchmark-home-phase3.css', 'utf8');
		expect(shellCss).toMatch(/\.public-menu-button\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s);
		expect(shellCss).toMatch(
			/\.public-mobile-drawer button\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s
		);
		expect(shellCss).toMatch(/\.public-mobile-drawer nav a\s*\{[^}]*min-height:\s*44px/s);
		expect(contentCss).toMatch(
			/\.results-cards \.card-actions a\s*\{[^}]*min-width:\s*44px[^}]*height:\s*44px/s
		);
		expect(navigationCss).toMatch(/\.mobile-tabbar a\s*\{[^}]*min-height:\s*48px/s);
		expect(homeDrawerCss).toMatch(
			/\.mobile-menu-button\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s
		);
		expect(homeDrawerCss).toMatch(
			/\.mobile-drawer-header button\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s
		);
		expect(homeDrawerCss).toMatch(/\.mobile-drawer nav a\s*\{[^}]*min-height:\s*44px/s);
	});
	it('keeps the global theme control clear of the mobile tabbar', () => {
		const layoutCss = readFileSync('src/routes/layout.css', 'utf8');
		expect(layoutCss).toMatch(
			/@media \(max-width: 900px\)[\s\S]*?\.theme-toggle\s*\{[^}]*bottom:\s*calc\(88px \+ env\(safe-area-inset-bottom\)\)/
		);
		expect(layoutCss).toMatch(
			/@media \(max-width: 900px\)[\s\S]*?\.theme-toggle\s*\{[^}]*min-height:\s*44px/
		);
	});
	it('uses the shared public shell for rankings and hotnews', () => {
		for (const file of ['src/routes/rankings/+page.svelte', 'src/routes/hotnews/+page.svelte']) {
			const page = readFileSync(file, 'utf8');
			expect(page).toContain('PublicShell');
			expect(page).toContain('listing-hero');
		}
	});
});
