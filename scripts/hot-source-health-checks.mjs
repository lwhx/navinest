import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Writes, simulated responses and failures are restricted to the owned LOCAL Worker/D1.
// UI preview responses are simulated; real fetch/parsing and atomic snapshots use injected
// fetchers in SQLite service tests, without weakening public-target protections.
export async function checkHotSourceHealth({
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
	const admin = await browser.newContext(),
		user = await browser.newContext(),
		anon = await browser.newContext();
	await admin.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
	await user.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
	const page = await admin.newPage(),
		errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	const endpoint = baseUrl + '/api/admin/hot-sources/preview',
		headers = { origin: baseUrl },
		post = (data) => admin.request.post(endpoint, { headers, data });
	const snapshot = () => ({
		sources: sql('SELECT * FROM hot_sources ORDER BY id'),
		items: sql('SELECT * FROM hot_items ORDER BY id'),
		messages: sql('SELECT * FROM messages ORDER BY id')
	});
	const preview = {
		count: 100,
		contentType: 'application/rss+xml',
		latencyMs: 25,
		checkedAt: '2026-10-17T00:15:00Z',
		items: Array.from({ length: 100 }, (_, i) => ({
			rank: i + 1,
			title: `中文解析条目 ${i + 1} · 标题与链接核对`,
			url: `https://example.com/topics/${i + 1}`,
			hotValue: '1.2万',
			extra: {}
		}))
	};
	let layouts = 0;
	try {
		assert.equal((await anon.request.post(endpoint, { headers, data: {} })).status(), 401);
		assert.equal((await user.request.post(endpoint, { headers, data: {} })).status(), 403);
		assert.equal(
			(
				await admin.request.post(endpoint, {
					headers: { origin: 'https://other.example' },
					data: {}
				})
			).status(),
			403
		);
		assert.equal(
			(
				await admin.request.post(endpoint, {
					headers: { ...headers, 'content-type': 'text/plain' },
					data: '{}'
				})
			).status(),
			415
		);
		assert.equal(
			(
				await admin.request.post(endpoint, {
					headers: { ...headers, 'content-type': 'application/json' },
					data: 'x'.repeat(65537)
				})
			).status(),
			413
		);
		for (const bad of ['{', '[]', Buffer.from([0xff])])
			assert.equal(
				(
					await admin.request.post(endpoint, {
						headers: { ...headers, 'content-type': 'application/json' },
						data: bad
					})
				).status(),
				400
			);
		const before = snapshot();
		const rejected = await post({
			type: 'rss',
			url: 'http://127.0.0.1/feed',
			headersJson: '{}',
			parserJson: '{}'
		});
		assert.equal(rejected.status(), 400);
		assert.ok((await rejected.json()).fields.url);
		assert.deepEqual(
			snapshot(),
			before,
			'preview must not change leases, timestamps, cached items or notifications'
		);
		sql(
			"INSERT INTO hot_sources(id,name,slug,type,url,last_success_at,last_error) VALUES(9901,'正常中文榜单','health-healthy','rss','https://example.com/healthy',CURRENT_TIMESTAMP,NULL),(9902,'失败后保留缓存','health-failed','rss','http://127.0.0.1/feed','2026-01-01T00:00:00Z','RSS/Atom 未解析到有效条目。'),(9903,'等待验证榜单','health-waiting','rss','https://example.com/waiting',NULL,NULL),(9904,'过期中文榜单','health-stale','rss','https://example.com/stale','2020-01-01T00:00:00Z',NULL),(9905,'已停用榜单','health-disabled','rss','https://example.com/disabled',NULL,NULL),(9906,'配置损坏榜单','health-malformed','rss','https://example.com/config',NULL,NULL); UPDATE hot_sources SET is_enabled=0 WHERE id=9905; UPDATE hot_sources SET parser_json='{' WHERE id=9906; INSERT INTO hot_items(source_id,rank,title,url,extra_json) VALUES(9902,1,'保留的旧缓存条目','https://example.com/cached','{');"
		);
		const seeded = snapshot();
		await page.goto(baseUrl + '/admin/hot-sources?edit=9903', { waitUntil: 'networkidle' });
		await page.locator('.hot-board-editor input[name=name]').fill('尚未保存的编辑');
		assert.equal(
			await page.locator('.hot-board-editor input[name=name]').inputValue(),
			'尚未保存的编辑'
		);
		await page.route('**/api/admin/hot-sources/preview', (route) => route.abort());
		await page
			.locator('.hot-board-editor')
			.getByRole('button', { name: '检查解析', exact: true })
			.click();
		await page.getByRole('status').filter({ hasText: '填写内容已保留' }).waitFor();
		assert.equal(
			await page.locator('.hot-board-editor input[name=name]').inputValue(),
			'尚未保存的编辑'
		);
		await page.unroute('**/api/admin/hot-sources/preview');
		let release;
		const held = new Promise((resolve) => (release = resolve));
		await page.route('**/api/admin/hot-sources/preview', async (route) => {
			await held;
			await route.fulfill({ json: { preview } });
		});
		await page
			.locator('.hot-board-editor')
			.getByRole('button', { name: '检查解析', exact: true })
			.click();
		await page.getByRole('button', { name: '检查中…', exact: true }).first().waitFor();
		assert.equal(
			await page.getByRole('button', { name: '保存榜单', exact: true }).isDisabled(),
			true
		);
		assert.equal(await page.locator('.hot-board-editor input[name=url]').isDisabled(), true);
		release();
		await page.locator('.hot-preview').waitFor();
		assert.equal(await page.locator('.hot-preview li').count(), 20);
		await page.getByRole('button', { name: '下一页', exact: true }).click();
		assert.match(await page.locator('.hot-preview li').first().innerText(), /条目 21/);
		await page.getByLabel('搜索预览条目').fill('topics/100');
		assert.equal(await page.locator('.hot-preview li').count(), 1);
		assert.match(await page.locator('.hot-preview').innerText(), /条目 100/);
		assert.deepEqual(
			snapshot(),
			seeded,
			'successful UI inspection leaves stored configuration and cache intact'
		);
		await page.locator('.hot-board-editor input[name=url]').fill('https://example.com/new-feed');
		await page.locator('.hot-preview').waitFor({ state: 'hidden' });
		await page.unroute('**/api/admin/hot-sources/preview');
		// A real refresh must reject unsafe stored targets before networking and keep old items.
		const refreshUrl = baseUrl + '/api/admin/hot-sources/9902/refresh';
		assert.equal(
			(
				await admin.request.post(refreshUrl, { headers: { origin: 'https://other.example' } })
			).status(),
			403
		);
		assert.equal((await admin.request.post(refreshUrl, { headers })).status(), 422);
		assert.equal(
			sql('SELECT title FROM hot_items WHERE source_id=9902')[0].title,
			'保留的旧缓存条目'
		);
		assert.ok(sql('SELECT last_fetch_at FROM hot_sources WHERE id=9902')[0].last_fetch_at);
		const alertCount = sql("SELECT COUNT(*) n FROM messages WHERE type='cron_alert'")[0].n;
		assert.equal((await admin.request.post(refreshUrl, { headers })).status(), 422);
		assert.equal(
			sql("SELECT COUNT(*) n FROM messages WHERE type='cron_alert'")[0].n,
			alertCount,
			'same incident must not send another message'
		);
		// Native preview validation and save remain useful with JavaScript disabled.
		const native = await browser.newContext({ javaScriptEnabled: false });
		try {
			await native.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
			const np = await native.newPage();
			await np.goto(baseUrl + '/admin/hot-sources?edit=9901');
			await np.locator('.hot-board-editor input[name=url]').fill('http://127.0.0.1/feed');
			await np
				.locator('.hot-board-editor')
				.getByRole('button', { name: '检查解析', exact: true })
				.click();
			await np.getByRole('status').filter({ hasText: '请检查订阅配置' }).waitFor();
			assert.equal(
				await np.locator('.hot-board-editor input[name=url]').inputValue(),
				'http://127.0.0.1/feed'
			);
			assert.ok(sql('SELECT last_success_at FROM hot_sources WHERE id=9901')[0].last_success_at);
			await np
				.locator('.hot-board-editor input[name=url]')
				.fill('https://example.com/changed-feed');
			await np.getByRole('button', { name: '保存榜单', exact: true }).click();
			await np.waitForURL('**/admin/hot-sources?updated=1');
			assert.equal(
				sql('SELECT last_success_at FROM hot_sources WHERE id=9901')[0].last_success_at,
				null
			);
		} finally {
			await native.close();
		}
		await page.goto(baseUrl + '/admin/hot-sources?edit=9906', { waitUntil: 'networkidle' });
		assert.equal(await page.locator('textarea[name=parserJson]').inputValue(), '{');
		assert.match(await page.locator('.hot-board-editor').innerText(), /JSON 已损坏/);
		for (const theme of ['light', 'dark'])
			for (const width of [320, 375, 768, 1366, 1920])
				for (const name of ['list', 'preview', 'public']) {
					await page.setViewportSize({ width, height: 1000 });
					await page.goto(
						baseUrl +
							(name === 'public'
								? '/hotnews'
								: name === 'preview'
									? '/admin/hot-sources?edit=9903'
									: '/admin/hot-sources'),
						{ waitUntil: 'networkidle' }
					);
					if ((await page.getByLabel('切换深色模式').isChecked()) !== (theme === 'dark'))
						await page.locator('.theme-toggle').click();
					await page.evaluate(() => document.fonts.ready);
					if (name === 'preview') {
						await page.route('**/api/admin/hot-sources/preview', (route) =>
							route.fulfill({ json: { preview } })
						);
						await page
							.locator('.hot-board-editor')
							.getByRole('button', { name: '检查解析', exact: true })
							.click();
						await page.locator('.hot-preview').waitFor();
						await page.unroute('**/api/admin/hot-sources/preview');
					}
					assert.ok(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
						`${name} ${width} overflow`
					);
					if (name !== 'public') {
						const dimensions = await page
							.locator(
								'.hot-board-admin-card button,.hot-board-admin-card a,.hot-preview button,.hot-board-editor button'
							)
							.evaluateAll((nodes) =>
								nodes
									.filter((n) => n.getBoundingClientRect().width > 0)
									.map((n) => ({
										text: n.textContent,
										h: n.getBoundingClientRect().height,
										w: n.getBoundingClientRect().width
									}))
							);
						assert.ok(
							dimensions.every((n) => n.h >= 43.5 && n.w >= 43.5),
							JSON.stringify(dimensions)
						);
						const ratio = await page
							.locator('.hot-source-health small')
							.first()
							.evaluate((node) => {
								const lum = (c) => {
									const a = c
										.match(/[\d.]+/g)
										.slice(0, 3)
										.map(Number)
										.map((v) => v / 255)
										.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
									return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
								};
								let bg = node;
								while (
									bg.parentElement &&
									getComputedStyle(bg).backgroundColor === 'rgba(0, 0, 0, 0)'
								)
									bg = bg.parentElement;
								const a = lum(getComputedStyle(node).color),
									b = lum(getComputedStyle(bg).backgroundColor);
								return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
							});
						assert.ok(ratio >= 4.5, `${theme} health contrast ${ratio}`);
					} else {
						assert.match(await page.locator('main').innerText(), /保留的旧缓存条目/);
						assert.equal(
							await page.getByText('RSS/Atom 未解析到有效条目。', { exact: true }).count(),
							0
						);
					}
					if (screenshots) {
						mkdirSync(screenshots, { recursive: true });
						await page.screenshot({
							path: join(screenshots, `hot-health-${name}-${width}-${theme}.png`),
							fullPage: true
						});
					}
					layouts++;
				}
		assert.deepEqual(errors, [], 'hot source workflow browser errors');
		console.log(
			`Hot sources: read-only preview boundaries, complete preview search/pagination, busy protection, cache preservation, deduplicated alerts, malformed historical config, native forms and ${layouts} CJK layouts passed.`
		);
		return layouts;
	} finally {
		await admin.close();
		await user.close();
		await anon.close();
	}
}
