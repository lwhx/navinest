import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const outboundFiles = [
	'src/routes/+page.svelte',
	'src/routes/hotnews/+page.svelte',
	'src/routes/user/submissions/+page.svelte',
	'src/routes/admin/submissions/+page.svelte',
	'src/lib/components/NavigationCard.svelte',
	'src/lib/components/HomeModuleFlow.svelte',
	'src/lib/components/CustomNavigationManager.svelte',
	'src/lib/components/ContentDetail.svelte'
];

describe('outbound link tabs', () => {
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
