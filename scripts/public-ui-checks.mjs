import assert from 'node:assert/strict';

export async function checkPublicUI(page, baseUrl) {
	await page.setViewportSize({ width: 1366, height: 900 });
	await page.goto(baseUrl, { waitUntil: 'networkidle' });
	await page.keyboard.press('Control+k');
	await page.waitForFunction(
		() => document.activeElement?.matches('.hero-search-form input'),
		null,
		{ timeout: 3000 }
	);
	const input = page.locator('.hero-search-form input');
	await input.fill('GitHub');
	await page.keyboard.press('/');
	assert.equal(await input.inputValue(), 'GitHub/');
	await page.getByRole('button', { name: '清空搜索', exact: true }).click();
	assert.equal(await input.inputValue(), '');
	assert.equal(await page.locator('.hero-search-form button[type="submit"]').isDisabled(), true);
	assert.equal(await page.locator('.engine-tabs button[aria-pressed="true"]').count(), 1);
	const cardLink = page.locator('.card-title-link').first();
	await page.keyboard.press('Tab');
	await cardLink.focus();
	const tooltipId = await cardLink.getAttribute('aria-describedby');
	assert.ok(tooltipId, 'Card title must expose its complete title and summary');
	await page.waitForFunction(
		(id) => getComputedStyle(document.getElementById(id)).visibility === 'visible',
		tooltipId
	);
	const detailUrl = await cardLink.getAttribute('href');

	for (const path of ['/', '/search?q=GitHub', '/search?q=unlikely-no-results-xyz', detailUrl]) {
		for (const width of [320, 768, 1366]) {
			await page.setViewportSize({ width, height: 900 });
			for (const dark of [false, true]) {
				await page.goto(new URL(path, baseUrl).href, { waitUntil: 'networkidle' });
				if ((await page.getByLabel('切换深色模式').isChecked()) !== dark)
					await page.locator('.theme-toggle').click();
				const sample = await page.evaluate(() => {
					const root = getComputedStyle(document.documentElement);
					const luminance = (color) => {
						const channels = color
							.match(/[\d.]+/g)
							.slice(0, 3)
							.map(Number)
							.map((n) => n / 255);
						const linear = channels.map((n) =>
							n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
						);
						return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
					};
					const contrast = [
						...document.querySelectorAll(
							'.public-header nav a, .public-user-link, .search-hero h1, .search-kicker, .search-submit, .detail-link, .direct-link, .empty-state p, .empty-state-action, .detail-content p, .detail-side dt, .public-footer small, .public-footer nav a'
						)
					]
						.filter((node) => node.getClientRects().length > 0)
						.map((node) => {
							let backgroundNode = node;
							while (
								backgroundNode.parentElement &&
								getComputedStyle(backgroundNode).backgroundColor === 'rgba(0, 0, 0, 0)'
							)
								backgroundNode = backgroundNode.parentElement;
							const levels = [
								luminance(getComputedStyle(node).color),
								luminance(getComputedStyle(backgroundNode).backgroundColor)
							].sort((a, b) => b - a);
							return {
								text: node.textContent.trim().slice(0, 40),
								ratio: (levels[0] + 0.05) / (levels[1] + 0.05)
							};
						});
					return {
						overflow: document.documentElement.scrollWidth - innerWidth,
						visitTargets: [...document.querySelectorAll('.benchmark-card .direct-link')].map(
							(link) => {
								const { width, height } = link.getBoundingClientRect();
								return { width, height };
							}
						),
						surface: root.getPropertyValue('--ui-surface').trim(),
						text: root.getPropertyValue('--ui-text').trim(),
						contrast
					};
				});
				assert.ok(sample.surface && sample.text, 'Public UI must use shared theme tokens');
				for (const target of sample.visitTargets) {
					assert.ok(
						target.width >= 44 && target.height >= 44,
						`${path} ${width}px: visit target must remain visible and at least 44px`
					);
				}
				assert.ok(
					sample.overflow <= 1,
					`${path} ${width}px: horizontal overflow ${sample.overflow}px`
				);
				for (const item of sample.contrast)
					assert.ok(
						item.ratio >= 4.5,
						`${path} ${width}px ${dark ? 'dark' : 'light'}: ${item.text} contrast ${item.ratio.toFixed(2)}`
					);
				if (width <= 900) {
					const home = path === '/';
					const opener = page.getByRole('button', { name: home ? '打开分类菜单' : '打开辅助菜单' });
					await opener.click();
					const dialog = page.getByRole('dialog', {
						name: home ? '分类导航' : '辅助菜单',
						exact: true
					});
					await page
						.waitForFunction(() => document.activeElement?.closest('[aria-modal="true"]'))
						.catch(async (error) => {
							const focus = await page.evaluate(() => ({
								active: document.activeElement?.outerHTML.slice(0, 300),
								modal: document.querySelector('[aria-modal="true"]')?.outerHTML.slice(0, 300)
							}));
							throw new Error(
								`${path} ${width}px ${dark ? 'dark' : 'light'}: drawer focus ${JSON.stringify(focus)}`,
								{ cause: error }
							);
						});
					await page.keyboard.press('Shift+Tab');
					assert.equal(
						await dialog
							.locator('a')
							.last()
							.evaluate((node) => node === document.activeElement),
						true
					);
					await page.keyboard.press('Tab');
					assert.equal(
						await dialog
							.getByRole('button', { name: home ? '关闭分类菜单' : '关闭辅助菜单' })
							.evaluate((node) => node === document.activeElement),
						true
					);
					await page.keyboard.press('Escape');
					assert.equal(await dialog.count(), 0);
					assert.equal(await opener.evaluate((node) => node === document.activeElement), true);
					assert.equal(await page.locator('[inert]').count(), 0);
				}
			}
		}
	}
	await page.setViewportSize({ width: 1366, height: 900 });
	await page.goto(new URL('/search', baseUrl).href, { waitUntil: 'networkidle' });
	await page.keyboard.press('/');
	await page.waitForFunction(() => document.activeElement?.matches('.public-search-form input'));
	await page.getByRole('searchbox', { name: '搜索关键词' }).fill('GitHub');
	await page.getByRole('button', { name: '搜索', exact: true }).click();
	await page.waitForURL('**/search?q=GitHub');
	assert.ok(await page.locator('.results-cards .card-title-link').count());
	await page.goto(new URL('/search?q=unlikely-no-results-xyz', baseUrl).href, {
		waitUntil: 'networkidle'
	});
	assert.equal(
		(await page.locator('.empty-state a').count()) > 0,
		true,
		'An empty search needs a next action'
	);
	console.log(
		'Public UI search, card descriptions, modal keyboard controls and 24 themed layouts passed.'
	);
}
