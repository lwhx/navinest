import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import HomePage from '../routes/+page.svelte';
import { fallbackHomeData } from '$lib/server/services/home';
import { SITE_SETTINGS_DEFAULTS } from '$lib/types/site';
import { describe, expect, it } from 'vitest';

const outboundFiles = [
	'src/routes/hotnews/+page.svelte',
	'src/routes/user/submissions/+page.svelte',
	'src/routes/admin/submissions/+page.svelte',
	'src/lib/components/NavigationCard.svelte',
	'src/lib/components/HomeModuleFlow.svelte',
	'src/lib/components/CustomNavigationManager.svelte',
	'src/lib/components/ContentDetail.svelte'
];

describe('outbound link tabs', () => {
	it('opens rendered homepage visits in isolated tabs after removing duplicate sidebar lists', () => {
		const { body } = render(HomePage, {
			props: { data: { ...fallbackHomeData(), site: SITE_SETTINGS_DEFAULTS, user: null } }
		});
		const visits = body.match(/<a[^>]*href="[^"]*\/go\?url=[^"]*"[^>]*>/g) ?? [];
		expect(visits.length).toBeGreaterThan(0);
		for (const anchor of visits) {
			expect(anchor).toContain('target="_blank"');
			expect(anchor).toContain('rel="external noopener noreferrer"');
		}
	});
	it.each(outboundFiles)('opens every safe outbound link in a new isolated tab: %s', (path) => {
		const source = readFileSync(path, 'utf8'),
			anchors = source
				.split('<a')
				.slice(1)
				.map((fragment) => `<a${fragment.split('</a>')[0]}</a>`)
				.filter((anchor) => anchor.includes('/go?url='));
		expect(anchors.length).toBeGreaterThan(0);
		for (const anchor of anchors) {
			expect(anchor).toContain('target="_blank"');
			expect(anchor).toContain('rel="external noopener noreferrer"');
		}
	});
});
