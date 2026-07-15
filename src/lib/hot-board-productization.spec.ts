import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicPage = readFileSync('src/routes/hotnews/+page.svelte', 'utf8'),
	adminPage = readFileSync('src/routes/admin/hot-sources/+page.svelte', 'utf8');

describe('custom RSS hot boards', () => {
	it('renders every board simultaneously as a dense customizable card grid', () => {
		expect(publicPage).toContain('hot-board-card-grid');
		expect(publicPage).toContain('{#each data.sources as source');
		expect(publicPage).toContain('hot-board-card');
		expect(publicPage).toContain('hot-board-rank');
		expect(publicPage).toContain('source.accentColor');
		expect(publicPage).toContain('source.showDescription');
		expect(publicPage).toMatch(/\.hot-board-rank\s*\{[^}]*max-height:\s*440px/s);
		expect(publicPage).toMatch(/\.hot-board-rank\s*\{[^}]*overflow-y:\s*auto/s);
		expect(publicPage).not.toContain('activeSlug');
		expect(publicPage).not.toContain('hot-board-tabs');
	});
	it('keeps card typography readable without abandoning the dense grid', () => {
		expect(publicPage).toMatch(/\.hot-board-brand h2\s*\{[^}]*font-size:\s*18px/s);
		expect(publicPage).toMatch(/\.hot-rank-copy a\s*\{[^}]*font-size:\s*14px/s);
		expect(publicPage).toMatch(/\.hot-rank-copy p\s*\{[^}]*font-size:\s*11px/s);
		expect(publicPage).toMatch(/\.hot-rank-number\s*\{[^}]*font-size:\s*11px/s);
		expect(publicPage).toMatch(/\.hot-value\s*\{[^}]*font-size:\s*11px/s);
		expect(publicPage).toMatch(/\.hot-board-meta\s*\{[^}]*font-size:\s*11px/s);
	});
	it('makes stale snapshots, full titles and internal scrolling discoverable', () => {
		expect(publicPage).toContain('boardStatus(source)');
		expect(publicPage).toContain('更新异常');
		expect(publicPage).toContain('显示上次成功数据');
		expect(publicPage).toContain('滚动查看全部');
		expect(publicPage).toContain('title={item.title}');
		expect(publicPage).toMatch(/\.hot-rank-copy a:focus-visible/);
		expect(publicPage).toContain('source.hasError');
		expect(publicPage).not.toContain('source.lastError');
		expect(publicPage).toContain('--board-accent-text');
		expect(publicPage).toContain('--board-on-accent');
		expect(publicPage).toMatch(
			/@media \(max-width: 760px\)[\s\S]*\.hot-board-rank\s*\{[^}]*max-height:\s*none[^}]*overflow-y:\s*visible/s
		);
	});
	it('exposes RSSHub board branding, layout, limits and order in admin', () => {
		for (const field of [
			'name="slug"',
			'name="description"',
			'name="icon"',
			'name="accentColor"',
			'name="surfaceColor"',
			'name="displayLimit"',
			'name="layout"',
			'name="sortOrder"',
			'name="showDescription"'
		])
			expect(adminPage).toContain(field);
		expect(adminPage).toContain('RSSHub / RSS / Atom');
		expect(adminPage).toContain('hot-board-admin-grid');
		expect(adminPage).toContain('refreshingId');
		expect(adminPage).toContain('刷新失败，请稍后重试');
		expect(adminPage).toContain('action="?/move"');
		expect(adminPage).toContain('上移榜单');
		expect(adminPage).toContain('下移榜单');
	});
});
