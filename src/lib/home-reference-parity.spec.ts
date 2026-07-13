import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const page = readFileSync('src/routes/+page.svelte', 'utf8');
const flow = readFileSync('src/lib/components/HomeModuleFlow.svelte', 'utf8');
const card = readFileSync('src/lib/components/NavigationCard.svelte', 'utf8');
const css = readFileSync('src/routes/home-reference.css', 'utf8');
describe('home reference parity', () => {
	it('uses one homepage stylesheet and separates hero from the content shell', () => {
		expect(page).toContain("import './home-reference.css'");
		expect(page).not.toMatch(/benchmark-home-phase[234]\.css/);
		expect(page).toContain('mode="hero"');
		expect(page).toContain('mode="content"');
	});
	it('renders the module plan in explicit hero and content modes', () => {
		expect(flow).toContain("mode: 'hero' | 'content'");
		expect(flow).toContain("mode === 'hero'");
		expect(flow).toContain("module.type !== 'search'");
	});
	it('keeps compact navigation cards free of article chrome', () => {
		expect(card).toContain('class:compact');
		expect(css).toContain('.benchmark-card.compact .site-content > p');
		expect(css).toContain('.benchmark-card.compact .type-chip');
		expect(css).toContain('.benchmark-card.compact .card-actions');
	});
	it('locks measured desktop and mobile proportions to the live reference', () => {
		expect(css).toContain('height: 604px');
		expect(css).toContain('grid-template-columns: repeat(6, minmax(0, 1fr))');
		expect(css).toContain('min-height: 60px');
		expect(css).toContain('@media (max-width: 620px)');
		expect(css).toContain('height: 510px');
		expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
		expect(css).toContain('.home-sidebar {\n		display: none');
	});
	it('keeps anchored category headings below the fixed header', () => {
		expect(css).toContain('scroll-margin-top: 104px');
	});
	it('filters child categories inside the current homepage module', () => {
		expect(flow).toContain('activeSubcategories');
		expect(flow).toContain('role="tablist"');
		expect(flow).toContain('role="tab"');
		expect(flow).toContain('aria-selected');
		expect(flow).toContain("activeSubcategories[section.slug] ?? 'all'");
		expect(flow).toContain('item.category === activeChildName');
		expect(css).toContain('.subcategory-tabs button.active');
	});
});
