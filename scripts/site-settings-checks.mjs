import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Owns only the parent harness's temporary LOCAL Worker/D1; never accepts a remote target.
export async function checkSiteSettings({
	browser,
	baseUrl,
	command,
	adminToken,
	userToken,
	screenshots
}) {
	assert.equal(new URL(baseUrl).hostname, '127.0.0.1');
	const sql = (statement) =>
		JSON.parse(
			command([
				'd1',
				'execute',
				'navinest-admin-check',
				'--local',
				'--command',
				statement,
				'--json'
			])
		)[0].results;
	const snapshot = () => sql('SELECT * FROM settings ORDER BY key');
	const admin = await browser.newContext(),
		user = await browser.newContext(),
		anon = await browser.newContext();
	await admin.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
	await user.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
	const page = await admin.newPage(),
		errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const api = baseUrl + '/api/admin/settings',
		headers = { origin: baseUrl };
	const read = async () => await (await admin.request.get(api)).json();
	const open = () => page.goto(baseUrl + '/admin/settings', { waitUntil: 'networkidle' });
	const flags = ['announcementEnabled', 'submissionsOpen', 'registrationOpen', 'sitemapEnabled'];
	const baseline = {
		siteName: '设置验收导航',
		siteTagline: '中文站点',
		siteDescription: '可读的站点描述',
		announcementEnabled: true,
		announcementMessage: '维护公告',
		announcementLink: '/search',
		announcementLinkLabel: '查看详情',
		submissionsOpen: true,
		registrationOpen: true,
		sitemapEnabled: true,
		robotsExtra: 'Disallow: /draft',
		extension: { keep: true }
	};
	let layouts = 0;
	try {
		sql(
			"INSERT INTO settings(key,value_json) VALUES('site','" +
				JSON.stringify(baseline).replaceAll("'", "''") +
				"') ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json"
		);
		assert.equal((await anon.request.get(api)).status(), 401);
		assert.equal((await user.request.put(api, { headers, data: {} })).status(), 403);
		assert.equal(
			(
				await admin.request.put(api, { headers: { origin: 'https://other.example' }, data: {} })
			).status(),
			403
		);
		assert.equal((await admin.request.put(api, { headers, data: {} })).status(), 428);
		await open();
		const before = snapshot();
		for (const name of flags) await page.locator('input[name=' + name + ']').uncheck();
		await page.locator('input[name=announcementLink]').fill('//example.com/bad');
		await page.getByRole('button', { name: '保存设置', exact: true }).click();
		await page.getByRole('status').filter({ hasText: '请检查表单' }).waitFor();
		for (const name of flags)
			assert.equal(await page.locator('input[name=' + name + ']').isChecked(), false);
		assert.equal(
			await page.locator('input[name=announcementLink]').inputValue(),
			'//example.com/bad'
		);
		assert.deepEqual(snapshot(), before);
		await page.locator('input[name=announcementLink]').fill('/search?q=中文');
		await page.locator('input[name=announcementEnabled]').check();
		await page.getByRole('button', { name: '预览展示', exact: true }).click();
		await page.getByRole('region', { name: '未保存的展示预览' }).waitFor();
		assert.match(await page.locator('.settings-preview').innerText(), /维护公告/);
		await page.locator('textarea[name=announcementMessage]').fill('修改后的预览正文');
		assert.match(await page.locator('.settings-preview').innerText(), /修改后的预览正文/);
		assert.match(await page.locator('.settings-actions').innerText(), /未保存/);
		assert.deepEqual(snapshot(), before, 'preview does not write');
		await page.locator('input[name=announcementEnabled]').uncheck();
		await page.locator('input[name=siteName]').fill('正式保存的中文名称');
		await page.getByRole('button', { name: '保存设置', exact: true }).click();
		await page.waitForURL('**/admin/settings?saved=*');
		await page.getByRole('status').filter({ hasText: '设置已保存' }).waitFor();
		for (const name of flags)
			assert.equal(await page.locator('input[name=' + name + ']').isChecked(), false);
		assert.equal(
			JSON.parse(sql("SELECT value_json FROM settings WHERE key='site'")[0].value_json).extension
				.keep,
			true
		);
		const home = await anon.newPage();
		await home.goto(baseUrl, { waitUntil: 'networkidle' });
		assert.match(await home.title(), /正式保存的中文名称/);
		assert.equal(await home.locator('.site-announcement').count(), 0);
		assert.equal((await anon.request.get(baseUrl + '/sitemap.xml')).status(), 404);
		const robots = await (await anon.request.get(baseUrl + '/robots.txt')).text();
		assert.match(robots, /Disallow: \/draft/);
		assert.doesNotMatch(robots, /Sitemap:/);
		assert.equal(
			(await anon.request.post(baseUrl + '/api/auth/register', { headers, data: {} })).status(),
			403
		);
		assert.equal(
			(await user.request.post(baseUrl + '/api/submissions', { headers, data: {} })).status(),
			403
		);
		const current = await read();
		assert.equal(
			(
				await admin.request.put(api, {
					headers,
					data: { ...current.data, revision: current.revision, siteTagline: '另一个页面保存' }
				})
			).status(),
			200
		);
		await page.locator('input[name=siteName]').fill('旧页面的草稿');
		await page.getByRole('button', { name: '保存设置', exact: true }).click();
		await page.getByRole('status').filter({ hasText: '设置已在其他页面改变' }).waitFor();
		assert.equal(await page.locator('input[name=siteName]').inputValue(), '旧页面的草稿');
		assert.equal((await read()).data.siteName, '正式保存的中文名称');
		assert.equal((await read()).data.siteTagline, '另一个页面保存');
		await open();
		await page.locator('input[name=siteName]').fill('响应丢失仍已保存');
		let release;
		const held = new Promise((resolve) => {
			release = resolve;
		});
		const action = (url) => url.pathname === '/admin/settings';
		await page.route(action, async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			await route.fetch();
			await held;
			await route.abort();
		});
		await page.getByRole('button', { name: '保存设置', exact: true }).click();
		await page.getByRole('button', { name: '保存中…', exact: true }).waitFor();
		assert.equal(await page.locator('input[name=siteName]').isDisabled(), true);
		release();
		await page.getByRole('status').filter({ hasText: '保存结果待核对' }).waitFor();
		assert.equal(await page.locator('input[name=siteName]').inputValue(), '响应丢失仍已保存');
		assert.equal((await read()).data.siteName, '响应丢失仍已保存');
		await page.unroute(action);
		await page.getByRole('button', { name: '保存设置', exact: true }).click();
		await page.getByRole('status').filter({ hasText: '设置已在其他页面改变' }).waitFor();
		const native = await browser.newContext({ javaScriptEnabled: false });
		try {
			await native.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
			const np = await native.newPage();
			await np.goto(baseUrl + '/admin/settings');
			await np.locator('input[name=announcementLink]').fill('//example.com/bad');
			await np.getByRole('button', { name: '保存设置', exact: true }).click();
			for (const name of flags)
				assert.equal(await np.locator('input[name=' + name + ']').isChecked(), false);
			await np.locator('input[name=announcementLink]').fill('/search');
			const untouched = snapshot();
			await np.getByRole('button', { name: '预览展示', exact: true }).click();
			assert.equal(await np.locator('.settings-preview').count(), 1);
			assert.deepEqual(snapshot(), untouched);
			await np.locator('input[name=siteName]').fill('原生表单保存成功');
			await np.getByRole('button', { name: '保存设置', exact: true }).click();
			await np.waitForURL('**/admin/settings?saved=*');
			assert.equal((await read()).data.siteName, '原生表单保存成功');
		} finally {
			await native.close();
		}
		const raw = sql("SELECT value_json FROM settings WHERE key='site'")[0].value_json;
		sql("UPDATE settings SET value_json='not-json' WHERE key='site'");
		await open();
		await page.getByRole('alert').filter({ hasText: '格式异常' }).waitFor();
		assert.equal(await page.locator('.site-settings-form').count(), 0);
		assert.equal(await page.locator('.settings-overview').count(), 0);
		assert.equal((await admin.request.get(api)).status(), 409);
		sql("UPDATE settings SET value_json='" + raw.replaceAll("'", "''") + "' WHERE key='site'");
		for (const theme of ['light', 'dark'])
			for (const width of [320, 375, 768, 1366, 1920])
				for (const preview of [false, true]) {
					await page.setViewportSize({ width, height: 1000 });
					await open();
					if ((await page.getByLabel('切换深色模式').isChecked()) !== (theme === 'dark'))
						await page.locator('.theme-toggle').click();
					if (preview) {
						await page.locator('input[name=announcementEnabled]').check();
						await page
							.locator('textarea[name=announcementMessage]')
							.fill('中文公告与特殊符号 <script> 不会执行，长内容在手机上完整换行。'.repeat(3));
						await page
							.locator('input[name=announcementLink]')
							.fill('https://example.com/' + 'very-long-path-'.repeat(12));
						await page.getByRole('button', { name: '预览展示', exact: true }).click();
					}
					await page.evaluate(() => document.fonts.ready);
					assert.ok(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
						`settings ${width} ${theme} overflow`
					);
					const dims = await page
						.locator(
							'.site-settings-form button,.site-settings-form input:not([type=hidden]):not([type=checkbox]),.site-settings-form textarea,.settings-switch'
						)
						.evaluateAll((nodes) =>
							nodes
								.filter((n) => n.getBoundingClientRect().width > 0)
								.map((n) => ({
									h: n.getBoundingClientRect().height,
									w: n.getBoundingClientRect().width
								}))
						);
					assert.ok(
						dims.every((n) => n.h >= 43.5 && n.w >= 43.5),
						JSON.stringify(dims)
					);
					const ratios = await page
						.locator('.settings-hint,.settings-switch small,.settings-overview span')
						.evaluateAll((nodes) => {
							const lum = (c) => {
								const a = c
									.match(/[\d.]+/g)
									.slice(0, 3)
									.map(Number)
									.map((v) => v / 255)
									.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
								return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
							};
							return nodes.map((n) => {
								let bg = n;
								while (
									bg.parentElement &&
									getComputedStyle(bg).backgroundColor === 'rgba(0, 0, 0, 0)'
								)
									bg = bg.parentElement;
								const a = lum(getComputedStyle(n).color),
									b = lum(getComputedStyle(bg).backgroundColor);
								return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
							});
						});
					assert.ok(
						ratios.every((r) => r >= 4.5),
						`${theme} contrast ${ratios}`
					);
					if (screenshots) {
						mkdirSync(screenshots, { recursive: true });
						await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
						await page.screenshot({
							path: join(
								screenshots,
								`settings-${preview ? 'preview' : 'form'}-${width}-${theme}.png`
							),
							fullPage: true
						});
					}
					layouts++;
				}
		assert.deepEqual(errors, []);
		console.log(
			`Site settings: unchecked error preservation, read-only live/native preview, guarded actual save, public branding/gates/SEO, concurrent writes, lost responses, extension preservation, malformed reads and ${layouts} CJK layouts passed.`
		);
		return layouts;
	} catch (error) {
		if (screenshots) {
			mkdirSync(screenshots, { recursive: true });
			await page.screenshot({ path: join(screenshots, 'settings-failure.png'), fullPage: true });
		}
		throw error;
	} finally {
		await admin.close();
		await user.close();
		await anon.close();
	}
}
