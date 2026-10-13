import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function checkHomeSubcategories(page, baseUrl, screenshots) {
	const selected = (section, name) =>
		page.locator(`#${section}`).getByRole('tab', { name, exact: true });
	const cardSlugs = (section) =>
		page
			.locator(`#${section} .card-title-link`)
			.evaluateAll((links) => links.map((link) => new URL(link.href).pathname));
	const hosting = ['/sites/resource-1', '/sites/resource-2'];
	// Use the actual D1-backed public page, including a grandchild and a private child item.
	await page.setViewportSize({ width: 1366, height: 900 });
	await page.goto(`${baseUrl}/?source=share#tools`, { waitUntil: 'networkidle' });
	await selected('tools', '代码托管').waitFor();
	await selected('tools', '代码托管').focus();
	const scroll = await page.evaluate(() => scrollY);
	let pageRequests = 0;
	const track = (request) => {
		const url = new URL(request.url());
		if (
			url.origin === new URL(baseUrl).origin &&
			(request.isNavigationRequest() || url.pathname.endsWith('__data.json'))
		)
			pageRequests++;
	};
	page.on('request', track);
	try {
		await page.keyboard.press('Enter');
		await page.waitForURL((url) => url.searchParams.get('sub.tools') === 'code-hosting');
		await page.waitForFunction(
			() => document.querySelector('#tools [aria-selected="true"]')?.textContent === '代码托管'
		);
		assert.deepEqual(await cardSlugs('tools'), hosting);
		assert.equal(new URL(page.url()).searchParams.get('source'), 'share');
		assert.equal(new URL(page.url()).hash, '#tools');
		assert.ok(
			Math.abs((await page.evaluate(() => scrollY)) - scroll) <= 2,
			'Category changes preserve the reading position'
		);
		assert.equal(
			await selected('tools', '代码托管').evaluate((node) => node === document.activeElement),
			true
		);
		assert.equal(
			pageRequests,
			0,
			'Changing an already loaded category does not reload the page or D1 data'
		);
		const length = await page.evaluate(() => history.length);
		await selected('tools', '代码托管').click();
		assert.equal(
			await page.evaluate(() => history.length),
			length,
			'Reselecting the active tab adds no duplicate history entry'
		);
	} finally {
		page.off('request', track);
	}

	await selected('tools', '前端开发').click();
	await page.waitForURL((url) => url.searchParams.get('sub.tools') === 'frontend');
	assert.deepEqual(await cardSlugs('tools'), ['/sites/resource-4']);
	await page.goBack();
	await page.waitForFunction(
		() => document.querySelector('#tools [aria-selected="true"]')?.textContent === '代码托管'
	);
	assert.deepEqual(await cardSlugs('tools'), hosting);
	await page.goForward();
	await page.waitForFunction(
		() => document.querySelector('#tools [aria-selected="true"]')?.textContent === '前端开发'
	);
	assert.deepEqual(await cardSlugs('tools'), ['/sites/resource-4']);
	await selected('design', '设计协作').click();
	await page.waitForURL((url) => url.searchParams.get('sub.design') === 'design-collaboration');
	assert.equal(new URL(page.url()).searchParams.get('sub.tools'), 'frontend');
	assert.deepEqual(await cardSlugs('design'), ['/sites/resource-5']);
	await selected('tools', '全部').click();
	await page.waitForURL((url) => !url.searchParams.has('sub.tools'));
	assert.equal(new URL(page.url()).searchParams.get('sub.design'), 'design-collaboration');
	await selected('tools', '代码托管').click();
	await page.waitForURL((url) => url.searchParams.get('sub.tools') === 'code-hosting');
	const shared = page.url();
	await page.reload({ waitUntil: 'networkidle' });
	assert.deepEqual(await cardSlugs('tools'), hosting);
	assert.equal(await selected('design', '设计协作').getAttribute('aria-selected'), 'true');
	await page.locator('#tools .card-title-link').first().click();
	await page.waitForURL('**/sites/resource-1');
	await page.locator('.product-detail-hero h1').waitFor();
	await page.goBack({ waitUntil: 'networkidle' });
	assert.equal(page.url(), shared);
	await page.waitForFunction(
		() => document.querySelector('#tools [aria-selected="true"]')?.textContent === '代码托管'
	);
	assert.deepEqual(await cardSlugs('tools'), hosting);
	assert.equal(await selected('design', '设计协作').getAttribute('aria-selected'), 'true');

	// A native modified click must open the URL's exact selection in a separate tab.
	const popupPromise = page.context().waitForEvent('page');
	await selected('tools', '前端开发').click({ button: 'middle' });
	const popup = await popupPromise;
	try {
		await popup.waitForLoadState('networkidle');
		assert.equal(new URL(popup.url()).searchParams.get('sub.tools'), 'frontend');
		assert.equal(new URL(popup.url()).searchParams.get('sub.design'), 'design-collaboration');
		assert.equal(await popup.locator('#tools [aria-selected="true"]').textContent(), '前端开发');
		assert.equal(page.url(), shared);
	} finally {
		await popup.close();
	}
	await selected('tools', '空分类').click();
	await page.waitForURL((url) => url.searchParams.get('sub.tools') === 'empty');
	assert.equal(await page.locator('#tools .card-title-link').count(), 0);
	assert.equal(await page.locator('#tools .inline-empty p').textContent(), '此分类暂时没有内容。');
	for (const query of [
		'sub.tools=deleted',
		'sub.tools=design-collaboration',
		'sub.tools=frontend&sub.tools=empty',
		'sub.unknown=code-hosting'
	]) {
		await page.goto(`${baseUrl}/?${query}#tools`, { waitUntil: 'networkidle' });
		assert.equal(await selected('tools', '全部').getAttribute('aria-selected'), 'true');
		assert.ok((await cardSlugs('tools')).length > hosting.length);
	}

	const native = await page.context().browser().newContext({ javaScriptEnabled: false });
	try {
		const tab = await native.newPage();
		const response = await tab.goto(shared);
		assert.equal(response.status(), 200);
		assert.deepEqual(
			await tab
				.locator('#tools .card-title-link')
				.evaluateAll((links) => links.map((link) => new URL(link.href).pathname)),
			hosting
		);
		assert.equal(await tab.locator('#tools [aria-selected="true"]').textContent(), '代码托管');
		await tab.locator('#tools').getByRole('tab', { name: '前端开发', exact: true }).click();
		await tab.waitForURL((url) => url.searchParams.get('sub.tools') === 'frontend');
		assert.equal(await tab.locator('#tools .card-title-link').count(), 1);
		assert.equal(new URL(tab.url()).searchParams.get('sub.design'), 'design-collaboration');
		await tab.locator('#tools').getByRole('tab', { name: '全部', exact: true }).click();
		await tab.waitForURL((url) => !url.searchParams.has('sub.tools'));
		assert.equal(new URL(tab.url()).searchParams.get('sub.design'), 'design-collaboration');
	} finally {
		await native.close();
	}

	if (screenshots) mkdirSync(screenshots, { recursive: true });
	for (const width of [320, 375, 1366, 1920, 2560]) {
		await page.setViewportSize({ width, height: 900 });
		for (const dark of [false, true]) {
			await page.goto(shared, { waitUntil: 'networkidle' });
			if ((await page.getByLabel('切换深色模式').isChecked()) !== dark)
				await page.locator('.theme-toggle').click();
			await page.evaluate(() => document.fonts.ready);
			const sample = await page.locator('#tools').evaluate((section) => {
				const tab = section.querySelector('[aria-selected="true"]');
				const colors = getComputedStyle(tab);
				return {
					overflow: document.documentElement.scrollWidth - innerWidth,
					height: tab.getBoundingClientRect().height,
					text: colors.color,
					background: colors.backgroundColor,
					widths: [...section.querySelectorAll('.site-content')].map(
						(node) => node.getBoundingClientRect().width
					)
				};
			});
			assert.ok(sample.overflow <= 1 && sample.widths.every((width) => width >= 120));
			assert.ok(sample.height >= (width <= 900 ? 44 : 36));
			const luminance = (color) => {
				const linear = color
					.match(/[\d.]+/g)
					.slice(0, 3)
					.map(Number)
					.map((n) => n / 255)
					.map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
				return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
			};
			const values = [luminance(sample.text), luminance(sample.background)].sort((a, b) => b - a);
			assert.ok(
				(values[0] + 0.05) / (values[1] + 0.05) >= 4.5,
				`${width}px: selected category contrast`
			);
			if (screenshots)
				await page.screenshot({
					path: join(screenshots, `home-subcategories-${width}-${dark ? 'dark' : 'light'}.png`)
				});
		}
	}
	console.log(
		'Homepage subcategory SSR, descendants/privacy, native links, sharing/history and 10 layouts passed.'
	);
}
