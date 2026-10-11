import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { checkPublicUI } from './public-ui-checks.mjs';
import { checkHomeExperience } from './home-experience-checks.mjs';

// Exercise the real homepage with fallback content, including all five card types.
const baseUrl = process.env.NAVINEST_LAYOUT_URL ?? 'http://127.0.0.1:5175';
const server = process.env.NAVINEST_LAYOUT_URL
	? undefined
	: spawn(
			process.execPath,
			['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort'],
			{
				env: { ...process.env, npm_lifecycle_event: 'dev' },
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
let serverOutput = '';
for (const stream of [server?.stdout, server?.stderr]) {
	stream?.on('data', (data) => {
		serverOutput = (serverOutput + data.toString()).slice(-6000);
	});
}
let browser;
try {
	let response;
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			response = await fetch(baseUrl, { signal: AbortSignal.timeout(3000) });
			break;
		} catch {
			await delay(200);
		}
	}
	assert.ok(response, `Homepage server did not start.\n${serverOutput}`);
	assert.equal(response.status, 200, `Homepage SSR failed.\n${serverOutput}`);
	await response.body?.cancel();
	browser = await chromium.launch({ executablePath: process.env.NAVINEST_CHROMIUM_PATH });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await checkPublicUI(page, baseUrl);
	// Sparse categories near the bottom must still align with the clicked menu entry.
	for (const width of [1100, 1920, 375]) {
		await page.setViewportSize({ width, height: 842 });
		await page.goto(baseUrl, { waitUntil: 'networkidle' });
		const slugs = await page
			.locator('[data-category-section]')
			.evaluateAll((sections) => sections.map((section) => section.id));
		assert.deepEqual(
			await page
				.locator('.home-sidebar nav a')
				.evaluateAll((links) => links.map((link) => link.hash.slice(1))),
			slugs,
			'Category menu order must match the rendered content modules'
		);
		for (const slug of [...slugs].reverse()) {
			const menu = width > 900 ? '.home-sidebar' : '.mobile-drawer';
			if (width <= 900) await page.getByRole('button', { name: '打开分类菜单' }).click();
			await page.locator(`${menu} a[href="#${slug}"]`).click();
			await page
				.waitForFunction(
					(slug) => {
						const target = document.getElementById(slug);
						const offset = parseFloat(getComputedStyle(target).scrollMarginTop);
						return Math.abs(target.getBoundingClientRect().top - offset) <= 2;
					},
					slug,
					{ timeout: 3000 }
				)
				.catch(async () => {
					assert.fail(`${width}px: clicking #${slug} did not align its heading below the header`);
				});
			await page.waitForFunction(
				(slug) =>
					document.querySelector('.home-sidebar a[aria-current="location"]')?.hash === `#${slug}`,
				slug,
				{ timeout: 3000 }
			);
			assert.equal(new URL(page.url()).hash, `#${slug}`);
			if (width <= 900) assert.equal(await page.locator('.mobile-drawer').count(), 0);
		}
		// Native history and direct fragment URLs must retain their category association.
		await page.goBack();
		await page.waitForFunction(
			() =>
				document.querySelector('.home-sidebar a[aria-current="location"]')?.hash === location.hash
		);
		await page.goto(`${baseUrl}#${slugs.at(-1)}`, { waitUntil: 'networkidle' });
		await page.waitForFunction(() => {
			const target = document.getElementById(location.hash.slice(1));
			return (
				Math.abs(
					target.getBoundingClientRect().top - parseFloat(getComputedStyle(target).scrollMarginTop)
				) <= 2
			);
		});
		// Manual scrolling through a tall category must not leave a stale selected menu item.
		await page.evaluate((slug) => {
			const target = document.getElementById(slug);
			target.style.minHeight = '1200px';
		}, slugs[0]);
		await page.evaluate((slug) => {
			const target = document.getElementById(slug);
			scrollTo(0, target.getBoundingClientRect().top + scrollY + 400);
		}, slugs[0]);
		await page.waitForFunction(
			(slug) =>
				document.querySelector('.home-sidebar a[aria-current="location"]')?.hash === `#${slug}`,
			slugs[0]
		);
		// Resize to a taller viewport after hydration, then click the final category again.
		await page.setViewportSize({ width, height: 1100 });
		if (width <= 900) await page.getByRole('button', { name: '打开分类菜单' }).click();
		await page
			.locator(`${width > 900 ? '.home-sidebar' : '.mobile-drawer'} a[href="#${slugs.at(-1)}"]`)
			.click();
		await page.waitForFunction(() => {
			const target = document.getElementById(location.hash.slice(1));
			return (
				Math.abs(
					target.getBoundingClientRect().top - parseFloat(getComputedStyle(target).scrollMarginTop)
				) <= 2
			);
		});
	}
	for (const width of [320, 375, 768, 1024, 1366, 1920]) {
		await page.setViewportSize({ width, height: 900 });
		for (const dark of [false, true]) {
			await page.goto(baseUrl, { waitUntil: 'networkidle' });
			if ((await page.getByLabel('切换深色模式').isChecked()) !== dark) {
				await page.locator('.theme-toggle').click();
			}
			await page.waitForFunction(
				(theme) => document.documentElement.dataset.theme === theme,
				dark ? 'dark' : 'light'
			);
			// Also exercise populated categories rather than only sparse fallback sections.
			// Reuse the rendered cards so the fixture retains the production markup and CSS.
			await page.evaluate(() => {
				for (const grid of document.querySelectorAll('.site-grid')) {
					const card = grid.firstElementChild;
					if (!card) continue;
					while (grid.children.length < 6) grid.appendChild(card.cloneNode(true));
				}
			});
			const layout = await page.evaluate(() => {
				const bounds = (selector) => document.querySelector(selector)?.getBoundingClientRect();
				return {
					overflow: document.documentElement.scrollWidth - innerWidth,
					heroHeight: bounds('.search-hero')?.height,
					cards: [...document.querySelectorAll('.benchmark-card')].map((card) => ({
						title: card.querySelector('h3')?.textContent,
						textWidth: card.querySelector('.site-content')?.getBoundingClientRect().width,
						overflow: card.scrollWidth - card.clientWidth
					})),
					metricCount: document.querySelectorAll('.card-metrics').length
				};
			});
			const label = `${width}px ${dark ? 'dark' : 'light'}`;
			assert.ok(layout.overflow <= 1, `${label}: horizontal page overflow ${layout.overflow}px`);
			assert.ok(layout.heroHeight <= 460, `${label}: search hero is ${layout.heroHeight}px tall`);
			assert.ok(layout.cards.length > 0, `${label}: no content cards rendered`);
			for (const card of layout.cards) {
				assert.ok(
					card.textWidth >= 120,
					`${label}: ${card.title} has only ${card.textWidth}px of text space`
				);
				assert.ok(card.overflow <= 1, `${label}: ${card.title} overflows by ${card.overflow}px`);
			}
			assert.equal(
				layout.metricCount,
				0,
				`${label}: home cards must not show view/favorite counts`
			);
			await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
			const headerColors = await page.locator('.home-header').evaluate((header) => ({
				background: getComputedStyle(header).backgroundColor,
				text: getComputedStyle(header.querySelector('.user-pill')).color
			}));
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
			const colors = [luminance(headerColors.background), luminance(headerColors.text)].sort(
				(a, b) => b - a
			);
			assert.ok(
				(colors[0] + 0.05) / (colors[1] + 0.05) >= 4.5,
				`${label}: fixed header text has insufficient contrast`
			);
		}
	}
	await checkHomeExperience(page, baseUrl);
	assert.deepEqual(errors, [], 'Homepage produced browser runtime errors');
	console.log(
		'Homepage category navigation, SSR and 12 layouts passed (320–1920px, light and dark).'
	);
} finally {
	await browser?.close();
	server?.kill('SIGTERM');
}
