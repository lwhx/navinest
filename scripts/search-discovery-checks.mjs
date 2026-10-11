import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const storageKey = 'navinest.search-engine';
function fixtures() {
	const path = join(tmpdir(), 'navinest-search-fixtures.json');
	const sources = [
		'src/lib/components/search-experience.spec.ts',
		'src/lib/components/HomeModuleFlow.svelte',
		'src/routes/search/+page.svelte',
		'src/routes/admin/home-modules/+page.svelte',
		'src/lib/search.ts'
	];
	if (
		!existsSync(path) ||
		sources.some((source) => statSync(source).mtimeMs > statSync(path).mtimeMs)
	) {
		// Render actual Svelte SSR markup for large datasets; never add demo content to production.
		execFileSync(
			process.execPath,
			['node_modules/vitest/vitest.mjs', 'run', 'src/lib/components/search-experience.spec.ts'],
			{ stdio: 'pipe' }
		);
	}
	return JSON.parse(readFileSync(path, 'utf8'));
}

export async function checkSearchDiscovery(page, baseUrl, screenshots) {
	if (screenshots) mkdirSync(screenshots, { recursive: true });
	await page.goto(baseUrl, { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'Google', exact: true }).click();
	await page.reload({ waitUntil: 'networkidle' });
	assert.equal(
		await page.locator('.engine-tabs button[aria-pressed="true"]').textContent(),
		'Google'
	);
	assert.equal(await page.getByRole('searchbox', { name: 'Google搜索' }).count(), 1);
	await page.context().route('https://www.google.com/search*', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'text/html',
			body: '<p>Search target checked locally</p>'
		})
	);
	try {
		await page.getByRole('button', { name: '设计资源', exact: true }).click();
		await page.waitForURL('https://www.google.com/search*');
		assert.equal(new URL(page.url()).searchParams.get('q'), '设计资源');
	} finally {
		await page.context().unroute('https://www.google.com/search*');
	}
	await page.goto(baseUrl, { waitUntil: 'networkidle' });
	await page.evaluate((key) => localStorage.setItem(key, 'deleted-source'), storageKey);
	await page.reload({ waitUntil: 'networkidle' });
	assert.equal(
		await page.locator('.engine-tabs button[aria-pressed="true"]').textContent(),
		'站内'
	);
	await page.getByRole('searchbox', { name: '站内搜索' }).fill('  开发工具  ');
	await page.locator('.hero-search-form button[type="submit"]').click();
	await page.waitForURL('**/search?q=*');
	assert.equal(new URL(page.url()).searchParams.get('q'), '开发工具');
	assert.equal(await page.locator('.results-cards .benchmark-card').count(), 2);
	await page.goto(new URL('/search?q=prototype&page=99', baseUrl).href, {
		waitUntil: 'networkidle'
	});
	assert.equal(await page.locator('.results-cards h3').textContent(), 'Figma');
	assert.equal(await page.locator('.search-pagination').count(), 0);
	await page.getByRole('searchbox', { name: '搜索关键词' }).fill('GitHub');
	await page.locator('.public-search-form button[type="submit"]').click();
	await page.waitForURL('**/search?q=GitHub');
	assert.equal(
		new URL(page.url()).searchParams.has('page'),
		false,
		'A new query resets pagination'
	);

	const browser = page.context().browser();
	const blockedContext = await browser.newContext();
	try {
		await blockedContext.addInitScript((key) => {
			const get = Storage.prototype.getItem,
				set = Storage.prototype.setItem;
			Storage.prototype.getItem = function (name) {
				if (name === key) throw new Error('blocked read');
				return get.call(this, name);
			};
			Storage.prototype.setItem = function (name, value) {
				if (name === key) throw new Error('blocked write');
				return set.call(this, name, value);
			};
		}, storageKey);
		const blockedPage = await blockedContext.newPage();
		const errors = [];
		blockedPage.on('pageerror', (error) => errors.push(error.message));
		await blockedPage.goto(baseUrl, { waitUntil: 'networkidle' });
		await blockedPage.getByRole('button', { name: 'Google', exact: true }).click();
		assert.equal(
			await blockedPage.locator('.engine-tabs button[aria-pressed="true"]').textContent(),
			'Google'
		);
		assert.deepEqual(errors, [], 'Blocked storage must not break selection');
	} finally {
		await blockedContext.close();
	}
	await page.goto(baseUrl, { waitUntil: 'networkidle' });
	await page.evaluate((key) => localStorage.removeItem(key), storageKey);

	const fixture = fixtures();
	await page.goto(new URL('/search?q=GitHub', baseUrl).href, { waitUntil: 'networkidle' });
	const head = await page.locator('head').innerHTML();
	// Keep the real app styles, but use native SSR links with no hydration on fixture pages.
	const styleHead = head.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
	const fixturePage = new URL('/search', baseUrl).href;
	await page.context().route(fixturePage + '?*', async (route) => {
		const url = new URL(route.request().url());
		if (url.searchParams.get('q') !== fixture.query) return route.continue();
		const number = Number(url.searchParams.get('page') ?? 1);
		const body = number === 50 ? fixture.longSearch : fixture.search[number - 1];
		assert.ok(body, 'Valid fixture page requested');
		await route.fulfill({
			status: 200,
			contentType: 'text/html',
			body: '<!doctype html><html><head>' + styleHead + '</head><body>' + body + '</body></html>'
		});
	});
	try {
		const params = new URLSearchParams({ q: fixture.query, page: '2' });
		await page.goto(fixturePage + '?' + params, { waitUntil: 'networkidle' });
		await page.getByRole('link', { name: '下一页', exact: true }).focus();
		await page.keyboard.press('Enter');
		await page.waitForURL('**&page=3');
		assert.equal(await page.locator('.results-cards .benchmark-card').count(), 13);
		assert.ok((await page.locator('.search-pagination p').textContent()).includes('第 3 / 3 页'));
		assert.equal(new URL(page.url()).searchParams.get('q'), fixture.query);
		await page.goBack({ waitUntil: 'networkidle' });
		assert.ok((await page.locator('.search-pagination p').textContent()).includes('第 2 / 3 页'));
		for (const width of [320, 375, 1366, 1920]) {
			await page.setViewportSize({ width, height: 900 });
			for (const dark of [false, true]) {
				const params = new URLSearchParams({ q: fixture.query, page: '50' });
				await page.goto(fixturePage + '?' + params, { waitUntil: 'networkidle' });
				await page.evaluate(
					(dark) => (document.documentElement.dataset.theme = dark ? 'dark' : 'light'),
					dark
				);
				await page.locator('.search-pagination').scrollIntoViewIfNeeded();
				const sample = await page.evaluate(() => ({
					overflow: document.documentElement.scrollWidth - innerWidth,
					targets: [...document.querySelectorAll('.search-pagination a')].map((link) => ({
						width: link.getBoundingClientRect().width,
						height: link.getBoundingClientRect().height
					})),
					badges: document.querySelectorAll('.type-chip').length
				}));
				assert.ok(sample.overflow <= 1, 'Pagination fits narrow and wide screens');
				assert.ok(
					sample.targets.every((target) => target.width >= 44 && target.height >= 44),
					'Pagination keeps 44px targets'
				);
				assert.equal(sample.badges, 0);
				if (screenshots)
					await page.screenshot({
						path: join(screenshots, `search-pages-${width}-${dark ? 'dark' : 'light'}.png`)
					});
			}
		}
	} finally {
		await page.context().unroute(fixturePage + '?*');
	}

	for (const width of [320, 375, 1366, 1920]) {
		await page.setViewportSize({ width, height: 900 });
		for (const dark of [false, true]) {
			await page.goto(baseUrl, { waitUntil: 'networkidle' });
			await page.evaluate(
				({ body, dark }) => {
					document.querySelector('.home-hero-flow').outerHTML = body;
					document.documentElement.dataset.theme = dark ? 'dark' : 'light';
				},
				{ body: fixture.recommendations, dark }
			);
			const last = page.locator('.search-recommendations button').last();
			await last.focus();
			const sample = await last.evaluate((button) => {
				const bounds = button.getBoundingClientRect(),
					box = button.parentElement.getBoundingClientRect();
				return {
					overflow: document.documentElement.scrollWidth - innerWidth,
					height: bounds.height,
					hero: document.querySelector('.search-hero').getBoundingClientRect().height,
					reachable: bounds.left >= box.left - 1 && bounds.right <= box.right + 1
				};
			});
			assert.ok(
				sample.overflow <= 1 && sample.hero <= 460,
				`${width}px ${dark ? 'dark' : 'light'}: eight long recommendation words stay within the hero ${JSON.stringify(sample)}`
			);
			assert.ok(
				sample.height >= 44 && sample.reachable,
				'Final recommendation is keyboard reachable'
			);
			if (screenshots)
				await page.screenshot({
					path: join(screenshots, `search-words-${width}-${dark ? 'dark' : 'light'}.png`)
				});
		}
	}
	for (const width of [375, 1366]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(baseUrl, { waitUntil: 'networkidle' });
		await page.evaluate(
			({ body, styles }) => {
				const style = document.createElement('style');
				style.textContent = styles;
				document.head.appendChild(style);
				document.body.innerHTML = body;
				document.documentElement.dataset.theme = 'light';
			},
			{ body: fixture.admin, styles: fixture.adminStyles }
		);
		await page.getByLabel('推荐搜索词').scrollIntoViewIfNeeded();
		assert.equal(
			await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
			0,
			'Admin word editor fits'
		);
		assert.equal(await page.getByLabel('推荐搜索词').inputValue(), '团队协作\n设计资源');
		if (screenshots)
			await page.screenshot({ path: join(screenshots, `search-admin-${width}.png`) });
	}
	console.log(
		'Search preference, literal queries, native pagination and 18 Chinese layout cases passed. Large datasets use actual Svelte SSR fixtures; D1 search is covered by SQLite integration tests.'
	);
}
