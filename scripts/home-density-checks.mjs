import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function checkHomeDensity(page, baseUrl, screenshots) {
	const measurements = [];
	for (const width of [320, 375, 1366, 1920, 2560]) {
		await page.setViewportSize({ width, height: 900 });
		for (const dark of [false, true]) {
			await page.goto(baseUrl, { waitUntil: 'networkidle' });
			if ((await page.getByLabel('切换深色模式').isChecked()) !== dark)
				await page.locator('.theme-toggle').click();
			await page.evaluate(() => document.fonts.ready);
			// Use real production markup to exercise a large resource/category dataset locally.
			await page.evaluate(() => {
				const grid = document.querySelector('#favorites .site-grid');
				const original = grid.firstElementChild.cloneNode(true);
				grid.replaceChildren();
				for (let index = 0; index < 30; index++) {
					const card = original.cloneNode(true);
					card.querySelector('h3').textContent =
						index % 7 === 0 ? `中文长标题团队资源与知识整理 ${index + 1}` : `常用资源 ${index + 1}`;
					card.querySelector('.card-summary').textContent = '整理资料、协作开发和查找常用工具';
					const tooltip = card.querySelector('[role="tooltip"]');
					tooltip.id = `density-description-${index}`;
					card.querySelector('.card-title-link').setAttribute('aria-describedby', tooltip.id);
					grid.appendChild(card);
				}
				// Local fallback data has no child categories. Match HomeModuleFlow's tab markup.
				const tabs = document.createElement('div');
				tabs.className = 'subcategory-tabs';
				tabs.setAttribute('role', 'tablist');
				tabs.setAttribute('aria-label', '常用推荐子分类');
				const template = document.createElement('button');
				template.type = 'button';
				template.setAttribute('role', 'tab');
				template.setAttribute('aria-selected', 'false');
				document.querySelector('#favorites .module-title > div').appendChild(tabs);
				for (let index = 0; index < 30; index++) {
					const tab = template.cloneNode(true);
					tab.textContent = `新增分类标签 ${index + 1}`;
					tab.classList.remove('active');
					tab.setAttribute('aria-selected', 'false');
					tabs.appendChild(tab);
				}
			});
			await page.locator('#favorites').scrollIntoViewIfNeeded();
			await page.evaluate(() => {
				const grid = document.querySelector('#favorites .site-grid');
				scrollTo(0, grid.getBoundingClientRect().top + scrollY - 90);
			});
			await page.mouse.move(0, 0);
			const sample = await page.evaluate(() => {
				const cards = [...document.querySelectorAll('#favorites .benchmark-card')];
				const tabs = document.querySelector('.subcategory-tabs');
				return {
					overflow: document.documentElement.scrollWidth - innerWidth,
					heights: cards.map((card) => card.getBoundingClientRect().height),
					detailTargets: cards.map((card) => {
						const { width, height } = card
							.querySelector('.card-title-link')
							.getBoundingClientRect();
						return { width, height };
					}),
					visible: cards.filter((card) => {
						const bounds = card.getBoundingClientRect();
						return bounds.top >= 80 && bounds.bottom <= innerHeight - 90;
					}).length,
					tabsScrollable: tabs.scrollWidth > tabs.clientWidth,
					headingFits:
						tabs.closest('.module-title').scrollWidth <=
						tabs.closest('.module-title').clientWidth + 1
				};
			});
			const label = `${width}px ${dark ? 'dark' : 'light'}`;
			assert.ok(sample.overflow <= 1, `${label}: many resources/tabs cause horizontal overflow`);
			assert.ok(
				sample.heights.every((height) => height <= 92),
				`${label}: resource cards too tall`
			);
			assert.ok(
				sample.detailTargets.every((target) => target.width >= 44 && target.height >= 44),
				`${label}: compact detail target must retain a 44px click area`
			);
			assert.ok(sample.visible >= 7, `${label}: too few complete resources in the viewport`);
			assert.ok(
				sample.tabsScrollable && sample.headingFits,
				`${label}: many tabs must scroll locally`
			);
			const lastTab = page.locator('.subcategory-tabs button').last();
			await lastTab.focus();
			const reachable = await lastTab.evaluate((tab) => {
				const target = tab.getBoundingClientRect();
				const container = tab.parentElement.getBoundingClientRect();
				return target.left >= container.left - 1 && target.right <= container.right + 1;
			});
			assert.ok(reachable, `${label}: keyboard focus must reveal the final category tab`);
			if (width <= 900)
				assert.ok((await lastTab.boundingBox()).height >= 44, `${label}: mobile category target`);
			await page.locator('#favorites').scrollIntoViewIfNeeded();
			await page.mouse.move(0, 0);
			if (screenshots) {
				await page.screenshot({
					path: join(screenshots, `dense-${width}-${dark ? 'dark' : 'light'}.png`)
				});
				await page.evaluate(() => {
					const heading = document.querySelector('#favorites .module-title');
					scrollTo(0, heading.getBoundingClientRect().top + scrollY - 90);
				});
				await page.screenshot({
					path: join(screenshots, `tabs-${width}-${dark ? 'dark' : 'light'}.png`)
				});
			}
			measurements.push({ label, height: sample.heights[0], visible: sample.visible });
			const purpose = page.locator('#favorites .card-summary').first();
			const detail = await purpose.locator('..').getAttribute('href');
			await purpose.click();
			await page.waitForURL(new URL(detail, baseUrl).href);
			assert.ok(
				await page.locator('.product-detail-hero h1').isVisible(),
				`${label}: purpose opens detail`
			);
		}
	}
	console.log('Dense Chinese resource cards / 30 category tabs:', JSON.stringify(measurements));
}
