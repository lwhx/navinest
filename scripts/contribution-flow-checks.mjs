import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The caller owns this isolated LOCAL Worker and database.
export async function checkContributionFlow({ browser, baseUrl, command, userToken, screenshots }) {
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
	sql(
		"INSERT INTO categories(id,type,parent_id,name,slug,is_visible) VALUES(6000,'site',NULL,'投稿开发资源','contribution-tools',1),(6001,'site',6000,'同名分类','contribution-code',1),(6002,'site',6001,'深层资源','contribution-deep',1),(6010,'site',NULL,'投稿设计资源','contribution-design',1),(6011,'site',6010,'同名分类','contribution-design-child',1),(6020,'post',NULL,'投稿文章','contribution-posts',1),(6021,'post',6020,'经验分享','contribution-stories',1),(6030,'site',NULL,'隐藏父级','contribution-hidden',0),(6031,'site',6030,'不可选择的子级','contribution-hidden-child',1)"
	);
	const context = await browser.newContext();
	await context.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const field = (name) => page.locator(`.contribute-flow [name="${name}"]`);
	const submit = () => page.getByRole('button', { name: '提交审核', exact: true });
	const chooseType = async (type) => {
		await page.locator(`.contribution-types a[href$="type=${type}"]`).click();
		await page.waitForURL((url) => url.searchParams.get('type') === type);
	};
	const chooseSite = async () => {
		await page.getByRole('combobox', { name: '一级分类', exact: true }).selectOption('6000');
		await page.getByRole('combobox', { name: '二级分类', exact: true }).selectOption('6001');
		await page.getByRole('combobox', { name: '三级分类', exact: true }).selectOption('6002');
	};
	try {
		await page.goto(baseUrl + '/contribute', { waitUntil: 'networkidle' });
		assert.equal(await page.locator('.contribution-types a').count(), 2);
		assert.deepEqual(
			await page
				.getByRole('combobox', { name: '一级分类', exact: true })
				.locator('option')
				.evaluateAll((options) =>
					options
						.map((o) => o.value)
						.filter(Boolean)
						.includes('6001')
				),
			false
		);
		assert.equal(
			await page
				.getByRole('combobox', { name: '一级分类', exact: true })
				.locator('option[value="6031"]')
				.count(),
			0
		);
		await field('url').fill('https://example.com/contribution-site');
		await field('title').fill('投稿流程网址');
		await field('summary').fill('手动编写的网址简介');
		await chooseSite();
		assert.equal(await field('categoryId').inputValue(), '6002');
		await chooseType('post');
		assert.equal(await field('title').inputValue(), '');
		assert.equal(await field('url').getAttribute('required'), null);
		await field('title').fill('切换时保留的文章');
		await field('content').fill('切换类型时应保留的正文');
		await page.getByRole('combobox', { name: '一级分类', exact: true }).selectOption('6020');
		await page.getByRole('combobox', { name: '二级分类', exact: true }).selectOption('6021');
		await chooseType('site');
		assert.equal(await field('title').inputValue(), '投稿流程网址');
		assert.equal(await field('categoryId').inputValue(), '6002');
		assert.match(
			await page.locator('.parent-selection-path').innerText(),
			/投稿开发资源 \/ 同名分类 \/ 深层资源/
		);
		await page.getByRole('combobox', { name: '一级分类', exact: true }).selectOption('6010');
		assert.equal(await field('categoryId').inputValue(), '6010');
		assert.equal(await page.getByRole('combobox', { name: '三级分类', exact: true }).count(), 0);
		await chooseSite();

		let release, started;
		const held = new Promise((resolve) => (release = resolve));
		const seen = new Promise((resolve) => (started = resolve));
		await page.route(baseUrl + '/api/submissions/enrich', async (route) => {
			const request = route.request().postDataJSON();
			assert.equal(request.type, 'site');
			started();
			await held;
			await route.fulfill({
				json: {
					snapshot: {
						fetchedUrl: request.url,
						title: '原始网页标题',
						description: '网页原始简介',
						excerpt: '网页补充说明',
						siteName: 'Example',
						fetchedAt: '2026-10-16T00:00:00Z'
					},
					suggestion: {
						title: '建议网址标题',
						summary: 'AI 建议简介',
						content: 'AI 建议说明',
						tags: ['示例标签'],
						categoryId: 6011,
						categoryName: '同名分类'
					},
					ai: { available: true, provider: '隔离测试', model: 'fixture' },
					duplicate: { published: ['已收录的公开网址'], pendingCount: 1 }
				}
			});
		});
		await page.getByRole('button', { name: '智能获取网页信息', exact: true }).click();
		await seen;
		assert.equal(await submit().isDisabled(), true);
		await page.locator('.contribution-types a[href$="type=post"]').click({ force: true });
		assert.equal(new URL(page.url()).searchParams.get('type'), 'site');
		await field('title').fill('读取期间编辑的标题');
		release();
		await page.getByRole('status').filter({ hasText: '网页信息和 AI 建议已就绪' }).waitFor();
		assert.equal(await field('title').inputValue(), '读取期间编辑的标题');
		assert.equal(await field('summary').inputValue(), '手动编写的网址简介');
		assert.equal(await field('categoryId').inputValue(), '6002');
		await page.getByRole('button', { name: '采用全部可用建议', exact: true }).click();
		assert.equal(await field('title').inputValue(), '读取期间编辑的标题');
		await page.getByRole('button', { name: '采用建议标题', exact: true }).click();
		assert.equal(await field('title').inputValue(), '建议网址标题');
		assert.match(await page.locator('.duplicate-warning').innerText(), /已收录的公开网址/);
		await page.unroute(baseUrl + '/api/submissions/enrich');
		await chooseType('post');
		assert.equal(await field('title').inputValue(), '切换时保留的文章');
		assert.equal(await field('content').inputValue(), '切换类型时应保留的正文');
		assert.equal(await field('categoryId').inputValue(), '6021');
		assert.equal(
			await page.getByRole('button', { name: '采用全部可用建议', exact: true }).count(),
			0
		);
		await chooseType('site');
		await field('title').fill('投稿流程网址');
		sql('UPDATE categories SET is_visible=0 WHERE id=6002');
		await submit().click();
		await page.getByRole('alert').filter({ hasText: '分类不存在' }).first().waitFor();
		assert.equal(await field('title').inputValue(), '投稿流程网址');
		assert.equal(await field('categoryId').inputValue(), '6002');
		assert.equal(
			await page
				.getByRole('combobox', { name: '一级分类', exact: true })
				.evaluate((el) => el === document.activeElement),
			true
		);
		sql('UPDATE categories SET is_visible=1 WHERE id=6002');
		await submit().click();
		await page.waitForURL(baseUrl + '/user/submissions');
		const savedSite = sql("SELECT type,payload_json FROM submissions WHERE title='投稿流程网址'");
		assert.equal(savedSite.length, 1);
		assert.equal(savedSite[0].type, 'site');
		assert.equal(JSON.parse(savedSite[0].payload_json).userCategoryId, 6002);
		assert.equal(JSON.parse(savedSite[0].payload_json).aiSuggestion.title, '建议网址标题');

		await page.goto(baseUrl + '/contribute?type=post', { waitUntil: 'networkidle' });
		await field('title').fill('无需网址的原创文章');
		await field('content').fill('文章直接填写正文，不需要先采集网页。');
		await submit().click();
		await page.waitForURL(baseUrl + '/user/submissions');
		const savedPost = sql(
			"SELECT type,payload_json FROM submissions WHERE title='无需网址的原创文章'"
		);
		assert.equal(savedPost.length, 1);
		assert.equal(savedPost[0].type, 'post');
		assert.equal(JSON.parse(savedPost[0].payload_json).url, null);

		await page.goto(baseUrl + '/contribute', { waitUntil: 'networkidle' });
		await field('url').fill('https://example.com/manual');
		await field('title').fill('读取失败仍保留手工标题');
		await page.route(baseUrl + '/api/submissions/enrich', (route) =>
			route.fulfill({ status: 422, json: { error: '隔离测试：读取失败，请手动填写。' } })
		);
		await page.getByRole('button', { name: '智能获取网页信息', exact: true }).click();
		await page.getByRole('alert').filter({ hasText: '隔离测试：读取失败' }).waitFor();
		assert.equal(await field('title').inputValue(), '读取失败仍保留手工标题');
		assert.equal(await submit().isEnabled(), true);
		await page.unroute(baseUrl + '/api/submissions/enrich');
		await page.route(baseUrl + '/api/submissions/enrich', (route) =>
			route.fulfill({
				json: {
					snapshot: {
						fetchedUrl: 'https://example.com/manual',
						title: '参考网页',
						description: '',
						excerpt: '',
						siteName: 'Example',
						iconUrl: 'https://example.com/favicon.png',
						fetchedAt: '2026-10-16T00:00:00Z'
					},
					suggestion: null,
					ai: { available: false }
				}
			})
		);
		await page.getByRole('button', { name: '智能获取网页信息', exact: true }).click();
		await page.getByRole('status').filter({ hasText: '网页信息已读取' }).waitFor();
		let releaseIcon, iconStarted;
		const iconHeld = new Promise((resolve) => (releaseIcon = resolve));
		const iconSeen = new Promise((resolve) => (iconStarted = resolve));
		await page.route(baseUrl + '/api/submissions/icon', async (route) => {
			iconStarted();
			await iconHeld;
			await route.fulfill({
				json: {
					data: {
						id: 999,
						previewUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
					}
				}
			});
		});
		await page.getByRole('button', { name: '使用网页图标', exact: true }).click();
		await iconSeen;
		assert.equal(await field('url').isDisabled(), true);
		releaseIcon();
		await page.getByRole('button', { name: '移除图标', exact: true }).waitFor();
		await field('url').fill('https://example.com/changed');
		assert.equal(await page.getByRole('button', { name: '移除图标', exact: true }).count(), 0);
		assert.equal(
			await page.getByRole('button', { name: '采用全部可用建议', exact: true }).count(),
			0
		);
		assert.equal(await field('title').inputValue(), '读取失败仍保留手工标题');
		await page.unroute(baseUrl + '/api/submissions/enrich');
		await page.unroute(baseUrl + '/api/submissions/icon');
		for (const type of ['app', 'book', 'bulletin']) {
			const result = await context.request.post(baseUrl + '/api/submissions', {
				data: { type, title: '不可新增旧类型', url: 'https://example.com', content: '内容' }
			});
			assert.equal(result.status(), 400);
		}
		assert.equal(sql("SELECT COUNT(*) AS n FROM submissions WHERE title='不可新增旧类型'")[0].n, 0);

		const native = await browser.newContext({ javaScriptEnabled: false });
		try {
			await native.addCookies(await context.cookies());
			const tab = await native.newPage();
			await tab.goto(baseUrl + '/contribute?type=post');
			await tab.locator('[name="title"]').fill('原生文章投稿');
			await tab.locator('[name="content"]').fill('   ');
			await tab.locator('noscript select[name="categoryId"]').selectOption('6021');
			await tab.getByRole('button', { name: '提交审核', exact: true }).click();
			await tab.getByRole('alert').filter({ hasText: '文章正文' }).first().waitFor();
			assert.equal(await tab.locator('[name="title"]').inputValue(), '原生文章投稿');
			assert.equal(await tab.locator('noscript select[name="categoryId"]').inputValue(), '6021');
			await tab.locator('[name="content"]').fill('原生表单完整正文');
			await tab.getByRole('button', { name: '提交审核', exact: true }).click();
			await tab.waitForURL(baseUrl + '/user/submissions');
			assert.equal(
				sql("SELECT COUNT(*) AS n FROM submissions WHERE title='原生文章投稿' AND type='post'")[0]
					.n,
				1
			);
		} finally {
			await native.close();
		}

		if (screenshots) mkdirSync(screenshots, { recursive: true });
		let layouts = 0;
		for (const width of [320, 375, 768, 1366, 1920])
			for (const dark of [false, true])
				for (const type of ['site', 'post']) {
					await page.setViewportSize({ width, height: 900 });
					await page.goto(baseUrl + '/contribute?type=' + type, { waitUntil: 'networkidle' });
					if ((await page.getByLabel('切换深色模式').isChecked()) !== dark)
						await page.locator('.theme-toggle').click();
					await field('title').fill('用于核对手机和桌面阅读体验的长中文标题');
					if (type === 'site') await chooseSite();
					else await field('content').fill('适合阅读的文章正文。\n'.repeat(20));
					await page.evaluate(() => document.fonts.ready);
					const contrast = await page.evaluate(() => {
						const luminance = (color) => {
							const rgb = color
								.match(/[\d.]+/g)
								.slice(0, 3)
								.map(Number)
								.map((n) => n / 255)
								.map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
							return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
						};
						return [
							...document.querySelectorAll(
								'.contribute-flow p, .contribute-flow small, .contribute-flow label > span, .contribute-flow button, .contribute-flow h2, .parent-selection-path'
							)
						]
							.filter((el) => el.getClientRects().length)
							.map((el) => {
								let bg = el;
								while (
									bg.parentElement &&
									getComputedStyle(bg).backgroundColor === 'rgba(0, 0, 0, 0)'
								)
									bg = bg.parentElement;
								const levels = [
									luminance(getComputedStyle(el).color),
									luminance(getComputedStyle(bg).backgroundColor)
								].sort((a, b) => b - a);
								return {
									text: el.textContent.trim().slice(0, 40),
									ratio: (levels[0] + 0.05) / (levels[1] + 0.05)
								};
							});
					});
					for (const item of contrast)
						assert.ok(item.ratio >= 4.5, JSON.stringify({ width, dark, type, ...item }));
					const sample = await page.evaluate(() => ({
						overflow: document.documentElement.scrollWidth > innerWidth + 1,
						controls: [
							...document.querySelectorAll(
								'.contribute-flow button, .contribute-flow select, .contribute-flow input:not([type="hidden"]):not([type="file"])'
							)
						]
							.filter((el) => el.getClientRects().length)
							.map((el) => ({
								label: el.name || el.textContent,
								height: el.getBoundingClientRect().height
							}))
					}));
					assert.equal(sample.overflow, false, JSON.stringify({ width, dark, type, sample }));
					assert.ok(
						sample.controls.every((control) => control.height >= 43.5),
						JSON.stringify(sample)
					);
					if (screenshots) {
						await page.locator('.contribute-flow').scrollIntoViewIfNeeded();
						await page.screenshot({
							path: join(
								screenshots,
								`contribution-${type}-${width}-${dark ? 'dark' : 'light'}.png`
							)
						});
					}
					layouts++;
				}
		assert.deepEqual(errors, []);
		console.log(
			`Contribution flow: website/article submissions, cascading categories, type-specific drafts, controlled AI, validation preservation, native forms and ${layouts} layouts passed.`
		);
		return layouts;
	} finally {
		await context.close();
	}
}
