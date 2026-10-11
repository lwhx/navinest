import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { checkHomeDensity } from './home-density-checks.mjs';

export async function checkHomeExperience(page, baseUrl) {
	await page.setViewportSize({ width: 1366, height: 900 });
	await page.goto(baseUrl, { waitUntil: 'networkidle' });
	assert.equal(await page.locator('.popular-sites').count(), 1, 'Only one main ranking dataset');
	assert.equal(
		await page.locator('.home-right-rail .rail-list').count(),
		0,
		'Sidebar must not duplicate ranking/hot datasets'
	);
	assert.equal(
		await page.locator('.home-module-flow section').first().getAttribute('id'),
		'favorites',
		'Default content starts with common recommendations'
	);
	assert.equal(await page.locator('.popular-sites .module-title a').textContent(), '更多');
	assert.equal(
		await page.locator('.popular-sites .module-title a').getAttribute('href'),
		'/rankings'
	);
	const rankCards = await page.locator('.popular-sites .benchmark-card').evaluateAll((cards) =>
		cards.map((card) => ({
			href: card.querySelector('.card-title-link').getAttribute('href'),
			title: card.querySelector('h3').textContent,
			type: new URL(card.querySelector('.card-title-link').href).pathname.split('/')[1]
		}))
	);
	assert.deepEqual(
		[...new Set(rankCards.map((card) => card.type))].sort(),
		['sites', 'apps', 'posts', 'books', 'bulletins'].sort()
	);
	for (const card of rankCards) {
		await page.goto(baseUrl, { waitUntil: 'networkidle' });
		const link = page.locator(`.popular-sites .card-title-link[href="${card.href}"]`);
		await link.focus();
		await page.keyboard.press('Enter');
		await page.waitForURL(new URL(card.href, baseUrl).href);
		assert.equal(
			await page.locator('.product-detail-hero h1').textContent(),
			card.title,
			'Ranking title must open that exact content'
		);
	}
	await page.goto(`${baseUrl}/rankings`, { waitUntil: 'networkidle' });
	const rankings = await page.locator('.ranking-list .ranking-title').evaluateAll((links) =>
		links.map((link) => ({
			href: link.getAttribute('href'),
			title: link.textContent
		}))
	);
	// The existing local ranking loader returns an empty list without D1.
	assert.equal(rankings.length, 0);
	assert.ok(await page.getByText('当前周期暂无排行').isVisible());
	await page.goto(baseUrl, { waitUntil: 'networkidle' });
	const visit = page.locator('.popular-sites .direct-link').first();
	const visitHref = await visit.getAttribute('href');
	assert.equal(new URL(visitHref, baseUrl).pathname, '/go');
	assert.equal(await visit.getAttribute('target'), '_blank');
	assert.match(await visit.getAttribute('rel'), /noopener/);
	const gatewayUrl = new URL(visitHref, baseUrl).href;
	const externalTarget = new URL(new URL(visitHref, baseUrl).searchParams.get('url')).href;
	let validated = false;
	// Fetch the real safe gateway without following its redirect, then stop the popup locally.
	await page.context().route(gatewayUrl, async (route) => {
		const response = await route.fetch({ maxRedirects: 0 });
		assert.equal(response.status(), 302);
		assert.equal(response.headers().location, externalTarget);
		validated = true;
		await route.fulfill({
			status: 200,
			contentType: 'text/html',
			body: '<p>Safe gateway validated</p>'
		});
	});
	try {
		const popupPromise = page.waitForEvent('popup');
		await visit.click();
		const popup = await popupPromise;
		await popup.waitForURL(gatewayUrl);
		assert.equal(validated, true);
		assert.equal(await popup.evaluate(() => window.opener === null), true);
		await popup.close();
	} finally {
		await page.context().unroute(gatewayUrl);
	}

	const cdp = await page.context().newCDPSession(page);
	await cdp.send('DOM.enable');
	await cdp.send('CSS.enable');
	const { root } = await cdp.send('DOM.getDocument');
	const { nodeId } = await cdp.send('DOM.querySelector', {
		nodeId: root.nodeId,
		selector: '#favorites-heading'
	});
	const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
	console.log(
		'Rendered Chinese heading fonts:',
		fonts.map((font) => `${font.familyName} (${font.glyphCount} glyphs)`).join(', ')
	);
	if (process.env.NAVINEST_REQUIRE_CJK === '1') {
		assert.ok(
			fonts.some(
				(font) =>
					font.glyphCount > 0 && /CJK|YaHei|PingFang|WenQuanYi|Heiti|Songti/i.test(font.familyName)
			),
			'Layout verification requires an actually rendered Chinese font'
		);
	}
	await cdp.detach();

	const screenshots = process.env.NAVINEST_SCREENSHOT_DIR;
	if (screenshots) await mkdir(screenshots, { recursive: true });
	for (const width of [320, 375, 1366, 1920, 2560]) {
		await page.setViewportSize({ width, height: 900 });
		for (const dark of [false, true]) {
			await page.goto(baseUrl, { waitUntil: 'networkidle' });
			if ((await page.getByLabel('切换深色模式').isChecked()) !== dark)
				await page.locator('.theme-toggle').click();
			await page.evaluate(() => document.fonts.ready);
			const sparse = await page.locator('#favorites .site-grid').evaluate((grid) => ({
				grid: grid.clientWidth,
				card: grid.firstElementChild.getBoundingClientRect().width,
				tracks: getComputedStyle(grid).gridTemplateColumns.split(' ').length
			}));
			if (sparse.tracks > 1)
				assert.ok(
					sparse.card <= sparse.grid / sparse.tracks + 1,
					'Sparse website cards must keep their normal grid width'
				);
			await page.locator('#favorites').scrollIntoViewIfNeeded();
			await page.mouse.move(0, 0);
			if (screenshots)
				await page.screenshot({
					path: join(screenshots, `home-${width}-${dark ? 'dark' : 'light'}.png`)
				});
			if (screenshots && [375, 1366].includes(width)) {
				await page.locator('.popular-sites').scrollIntoViewIfNeeded();
				await page.screenshot({
					path: join(screenshots, `ranking-${width}-${dark ? 'dark' : 'light'}.png`)
				});
			}
			// Clone production markup for visual edge cases; no formal data or route is changed.
			await page.evaluate(() => {
				const card = document.querySelector('#favorites .benchmark-card');
				const grid = card.parentElement;
				const original = card.cloneNode(true);
				card.querySelector('h3').textContent =
					'中文长标题与用途说明：用于整理团队知识、设计素材和开发资源';
				card.querySelector('.card-summary').textContent =
					'用途简介可以直接阅读，这是一段很长的中文简介，用于检查截断与布局稳定性。';
				const english = original.cloneNode(true);
				english.querySelector('h3').textContent = 'SuperLongUnbrokenEnglishResourceName'.repeat(5);
				english.querySelector('.card-summary').textContent = 'UnbrokenPurposeDescription'.repeat(
					10
				);
				grid.appendChild(english);
				const empty = original.cloneNode(true);
				empty.querySelector('h3').textContent = '无简介、无自定义图标';
				empty.querySelector('.card-summary').remove();
				empty.querySelector('img')?.remove();
				grid.appendChild(empty);
			});
			const sample = await page.evaluate(() => ({
				overflow: document.documentElement.scrollWidth - innerWidth,
				cards: [...document.querySelectorAll('.benchmark-card')].map((card) => {
					const content = card.querySelector('.site-content');
					const summary = card.querySelector('.card-summary');
					const title = card.querySelector('.card-title-link');
					const heading = card.querySelector('h3');
					return {
						overflow: card.scrollWidth - card.clientWidth,
						textWidth: content.getBoundingClientRect().width,
						summaryVisible:
							!summary ||
							(getComputedStyle(summary).display !== 'none' &&
								summary.getBoundingClientRect().height > 0),
						summaryFits:
							!summary ||
							summary.getBoundingClientRect().width <= content.getBoundingClientRect().width + 1,
						titleSize: getComputedStyle(title).fontSize,
						titleWeight: getComputedStyle(title).fontWeight,
						typeAbsent: !card.querySelector('.type-chip'),
						secondaryAbsent: !card.querySelector('.card-secondary'),
						order:
							!summary ||
							heading.getBoundingClientRect().bottom <= summary.getBoundingClientRect().top + 1,
						metricsAbsent: !card.querySelector('.card-metrics')
					};
				})
			}));
			const label = `${width}px ${dark ? 'dark' : 'light'}`;
			assert.ok(sample.overflow <= 1, `${label}: page overflow`);
			for (const card of sample.cards) {
				assert.ok(
					card.overflow <= 1 && card.textWidth >= 120,
					`${label}: readable card width without overflow`
				);
				assert.ok(
					card.summaryVisible && card.summaryFits,
					`${label}: purpose must be visible and contained`
				);
				assert.ok(
					card.typeAbsent && card.secondaryAbsent,
					`${label}: no type badge or empty metadata row`
				);
				assert.equal(card.titleSize, '16px', `${label}: preserve title size`);
				assert.equal(card.titleWeight, '600', `${label}: preserve title weight`);
				assert.ok(
					card.order && card.metricsAbsent,
					`${label}: title/purpose order without view/favorite counts`
				);
			}
			if (screenshots) {
				await page.locator('#favorites').scrollIntoViewIfNeeded();
				await page.mouse.move(0, 0);
				await page.screenshot({
					path: join(screenshots, `edges-${width}-${dark ? 'dark' : 'light'}.png`)
				});
			}
		}
	}
	await checkHomeDensity(page, baseUrl, screenshots);
	// Public component consumers must retain summaries and independent actions after navigating from home.
	for (const path of ['/search?q=GitHub', '/categories/dev-tools', '/tags/code', '/sites/github']) {
		for (const width of [320, 1366]) {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(new URL(path, baseUrl).href, { waitUntil: 'networkidle' });
			assert.equal(
				await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
				false,
				`${path}: public-page overflow`
			);
			for (const summary of await page.locator('.benchmark-card .card-summary').all())
				assert.ok(await summary.isVisible(), `${path}: public card summary hidden`);
		}
	}
	console.log(
		'Ranking detail clicks, safe visit, stat-free sparse/edge-case cards and 10 Chinese themed layouts passed (320–2560px).'
	);
}
