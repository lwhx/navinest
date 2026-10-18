import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// All mutations use only the parent harness's temporary LOCAL database and Worker.
export async function checkSavedLinks({
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
	const url = baseUrl + '/admin/link-checks',
		action = url + '?/check',
		headers = { origin: baseUrl };
	const open = (query = '') => page.goto(url + query, { waitUntil: 'networkidle' });
	let layouts = 0;
	try {
		assert.equal(
			(await anon.request.post(action, { headers, form: { ids: '8000' } })).status(),
			401
		);
		assert.equal(
			(await user.request.post(action, { headers, form: { ids: '8000' } })).status(),
			403
		);
		assert.equal(
			(
				await admin.request.post(action, {
					headers: { origin: 'https://other.example' },
					form: { ids: '8000' }
				})
			).status(),
			403
		);
		sql(`INSERT INTO items(id,type,title,slug,status,visibility) SELECT 8000+value,'site','网址检查资源 '||printf('%03d',value),'link-check-'||value,CASE WHEN value%2=0 THEN 'published' ELSE 'draft' END,CASE WHEN value%3=0 THEN 'public' ELSE 'private' END FROM json_each('${JSON.stringify(Array.from({ length: 225 }, (_, i) => i))}');
		INSERT INTO item_meta(item_id,meta_key,meta_value) SELECT id,'site_url','http://127.0.0.1/check-'||id FROM items WHERE id BETWEEN 8000 AND 8224;`);
		const snapshot = () => sql('SELECT * FROM items WHERE id BETWEEN 8000 AND 8224 ORDER BY id');
		const before = snapshot();
		await open('?q=网址检查资源&page=9999');
		assert.equal(await page.locator('.check-row').count(), 5);
		assert.match(await page.locator('.check-toolbar').innerText(), /共 225 项/);
		await page.getByRole('link', { name: '上一页', exact: true }).click();
		await page
			.locator('.check-toolbar')
			.filter({ hasText: /第 11 \/ 12 页/ })
			.waitFor();
		assert.equal(new URL(page.url()).searchParams.get('q'), '网址检查资源');
		assert.equal(await page.locator('.check-row').count(), 20);
		await open('?q=网址检查资源');
		const boxes = page.locator('input[name=ids]');
		for (let i = 0; i < 3; i++) await boxes.nth(i).check();
		assert.equal(await boxes.nth(3).isDisabled(), true);
		await page.getByRole('button', { name: '检查所选网址', exact: true }).click();
		await page.getByRole('status').filter({ hasText: '已记录 3 个检查结果' }).waitFor();
		assert.equal(
			sql("SELECT COUNT(*) n FROM settings WHERE key GLOB 'admin:link-check:item:*'")[0].n,
			3
		);
		assert.deepEqual(snapshot(), before, 'checking must not alter saved content');
		assert.equal(await boxes.nth(3).isDisabled(), false);
		await page.locator('select[name=result]').selectOption('blocked');
		await page.getByRole('button', { name: '筛选', exact: true }).click();
		await page.waitForURL(/result=blocked/);
		await page.locator('.check-toolbar').filter({ hasText: '共 3 项' }).waitFor();
		assert.equal(await page.locator('.check-row').count(), 3);
		const id = Number(await page.locator('.check-row').first().getAttribute('data-check-id'));
		const [editor] = await Promise.all([
			admin.waitForEvent('page'),
			page.locator('.check-row').first().getByRole('link', { name: /编辑/ }).click()
		]);
		await editor.waitForLoadState('networkidle');
		assert.equal(
			await editor.locator('input[name=site_url]').inputValue(),
			'http://127.0.0.1/check-' + id
		);
		await editor.close();
		sql(
			`UPDATE item_meta SET meta_value='https://example.com/changed' WHERE item_id=${id} AND meta_key='site_url'`
		);
		await open('?q=网址检查资源&result=stale');
		assert.equal(await page.locator('.check-row').count(), 1);
		assert.match(await page.locator('.check-row').innerText(), /旧网址/);
		// Known classification fixtures test display/filtering; network classification has mocked unit tests.
		for (const [i, status, http] of [
			[8000, 'gone', 404],
			[8001, 'uncertain', 403],
			[8002, 'redirected', 200]
		]) {
			const result = {
				url: 'http://127.0.0.1/check-' + i,
				status,
				httpStatus: http,
				finalUrl: status === 'redirected' ? 'https://example.com/final' : null,
				reason: status === 'redirected' ? 'ok' : 'http',
				checkedAt: '2026-10-18T00:00:00.000Z'
			};
			sql(
				"INSERT OR REPLACE INTO settings(key,value_json) VALUES('admin:link-check:item:" +
					i +
					"','" +
					JSON.stringify(result).replaceAll("'", "''") +
					"')"
			);
		}
		for (const [result, label] of [
			['gone', '404 / 410'],
			['uncertain', '待核实'],
			['redirected', '发生跳转']
		]) {
			await open('?q=网址检查资源&result=' + result);
			assert.equal(await page.locator('.check-row').count(), 1);
			assert.match(await page.locator('.check-badge').innerText(), new RegExp(label));
		}
		// Delayed/unknown client response must guard duplicate submission and leave a recovery message.
		await open('?q=check-8223');
		await page.locator('input[name=ids]').check();
		let release;
		const gate = new Promise((resolve) => (release = resolve));
		let posts = 0;
		await page.route('**/admin/link-checks**', async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			posts++;
			await gate;
			await route.fulfill({
				status: 503,
				contentType: 'text/html',
				body: 'temporarily unavailable'
			});
		});
		await page.getByRole('button', { name: '检查所选网址', exact: true }).click();
		assert.equal(await page.locator('button[type=submit]').last().isDisabled(), true);
		assert.equal(await page.locator('input[name=ids]').isDisabled(), true);
		release();
		await page.getByRole('status').filter({ hasText: '检查结果待核对' }).waitFor();
		assert.equal(posts, 1);
		assert.equal(await page.locator('input[name=ids]').isDisabled(), false);
		await page.unroute('**/admin/link-checks**');
		const native = await browser.newContext({ javaScriptEnabled: false });
		await native.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
		try {
			const np = await native.newPage();
			await np.goto(url + '?q=check-8003');
			await np.locator('input[name=ids]').check();
			await Promise.all([
				np.waitForNavigation(),
				np.getByRole('button', { name: '检查所选网址', exact: true }).click()
			]);
			assert.match(
				await np.locator('.admin-form-message[role=status]').innerText(),
				/已记录 1 个检查结果/
			);
			assert.equal(
				sql("SELECT COUNT(*) n FROM settings WHERE key='admin:link-check:item:8003'")[0].n,
				1
			);
		} finally {
			await native.close();
		}
		await open('?q=网址检查资源');
		for (const width of [320, 390, 768, 1440])
			for (const theme of ['light', 'dark']) {
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate((theme) => {
					document.documentElement.dataset.theme = theme;
					localStorage.setItem('navinest-theme', theme);
				}, theme);
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth > innerWidth + 1
				);
				assert.equal(overflow, false, `link checks overflow at ${width} ${theme}`);
				const sizes = await page
					.locator(
						'.check-select,.check-edit,.check-filters input,.check-filters select,.check-toolbar button'
					)
					.evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
				assert.ok(
					sizes.every((size) => size >= 43.5),
					JSON.stringify(sizes)
				);
				if (screenshots) {
					mkdirSync(screenshots, { recursive: true });
					await page.screenshot({
						path: join(screenshots, `link-checks-${width}-${theme}.png`),
						fullPage: true
					});
				}
				layouts++;
			}
		assert.deepEqual(errors, []);
		console.log(
			`Saved URLs: guarded real local checks, classifications, complete filtering/pagination, stale URLs, editor shortcuts, native forms, unknown responses and ${layouts} CJK layouts passed.`
		);
		return layouts;
	} finally {
		await admin.close();
		await user.close();
		await anon.close();
	}
}
