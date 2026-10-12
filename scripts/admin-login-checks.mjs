import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function checkAdminLogin(page, baseUrl, screenshots) {
	if (screenshots) await mkdir(screenshots, { recursive: true });
	const returnTo = '/admin/items?type=site&query=' + encodeURIComponent('中文 资源');
	for (const width of [320, 1366]) {
		await page.setViewportSize({ width, height: 900 });
		for (const dark of [false, true]) {
			await page.goto(new URL('/login?returnTo=' + encodeURIComponent(returnTo), baseUrl).href, {
				waitUntil: 'networkidle'
			});
			if ((await page.getByLabel('切换深色模式').isChecked()) !== dark)
				await page.locator('.theme-toggle').click();
			await page.evaluate(() => document.fonts.ready);
			assert.equal(await page.locator('.account-hero h1').textContent(), '登录管理后台');
			const github = page.getByRole('link', { name: '使用 GitHub 登录' });
			assert.equal(await github.count(), 0, 'GitHub sign-in is paused');
			assert.equal(
				await page.locator('.account-divider').count(),
				0,
				'Password-only login has no empty alternatives divider'
			);
			assert.equal(await page.locator('.account-form').getAttribute('method'), 'POST');
			assert.equal(
				await page.locator('.account-form').getAttribute('action'),
				null,
				'Native form preserves the login query'
			);
			const layout = await page.evaluate(() => ({
				overflow: document.documentElement.scrollWidth - innerWidth,
				targets: [...document.querySelectorAll('.account-form input, .account-button')].map(
					(node) => node.getBoundingClientRect().height
				)
			}));
			assert.ok(layout.overflow <= 1, 'Admin login must fit the viewport');
			assert.ok(
				await page
					.locator('.account-actions')
					.evaluate(
						(actions) =>
							actions.getBoundingClientRect().top -
								document.querySelector('.account-form').getBoundingClientRect().bottom >=
							16
					),
				'Password and home actions keep separation after removing the divider'
			);
			assert.ok(
				layout.targets.every((height) => height >= 44),
				'Sign-in controls must retain touch size'
			);
			await page.getByRole('textbox', { name: '用户名或邮箱' }).focus();
			assert.equal(await page.evaluate(() => document.activeElement.name), 'identifier');
			await page.keyboard.press('Tab');
			assert.equal(await page.evaluate(() => document.activeElement.name), 'password');
			const cdp = await page.context().newCDPSession(page);
			await cdp.send('DOM.enable');
			await cdp.send('CSS.enable');
			const { root } = await cdp.send('DOM.getDocument');
			const { nodeId } = await cdp.send('DOM.querySelector', {
				nodeId: root.nodeId,
				selector: '.account-hero h1'
			});
			const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
			if (process.env.NAVINEST_REQUIRE_CJK === '1')
				assert.ok(
					fonts.some(
						(font) =>
							font.glyphCount > 0 &&
							/CJK|YaHei|PingFang|WenQuanYi|Heiti|Songti/i.test(font.familyName)
					),
					'Admin login requires an actually rendered Chinese font'
				);
			await cdp.detach();
			if (screenshots)
				await page.screenshot({
					path: join(screenshots, `admin-login-${width}-${dark ? 'dark' : 'light'}.png`),
					fullPage: true
				});
		}
	}
	await page.goto(new URL('/login?returnTo=https%3A%2F%2Fevil.example%2Fadmin', baseUrl).href, {
		waitUntil: 'networkidle'
	});
	assert.equal(await page.locator('.account-hero h1').textContent(), '登录 NaviNest');
	assert.equal(await page.getByRole('link', { name: '使用 GitHub 登录' }).count(), 0);
	for (const path of ['/api/auth/github', '/api/auth/github/callback?code=unused&state=unused']) {
		const response = await page.request.get(new URL(path, baseUrl).href);
		assert.equal(
			response.status(),
			503,
			'Paused OAuth cannot be started or completed by visiting the old URL'
		);
		assert.ok((await response.text()).includes('GitHub 登录暂时关闭'));
	}
	console.log(
		'Administrator sign-in: 4 desktop/mobile Chinese layouts and safe return links passed'
	);
}
