import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Every write, response simulation and fixture is restricted to the owned LOCAL Worker/D1.
export async function checkSearchSources({
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
		home = await anon.newPage(),
		errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	home.on('pageerror', (e) => errors.push(e.message));
	const headers = { origin: baseUrl },
		api = baseUrl + '/api/admin/search-engines',
		snapshot = () => sql('SELECT * FROM search_engines ORDER BY id');
	const open = (path) => page.goto(baseUrl + path, { waitUntil: 'networkidle' });
	let layouts = 0;
	try {
		assert.equal((await anon.request.post(api, { headers, data: {} })).status(), 401);
		assert.equal((await user.request.post(api, { headers, data: {} })).status(), 403);
		assert.equal(
			(
				await admin.request.post(api, { headers: { origin: 'https://other.example' }, data: {} })
			).status(),
			403
		);
		assert.equal((await admin.request.delete(api + '/1', { headers })).status(), 428);
		assert.equal(
			(
				await admin.request.patch(api + '/1', {
					headers: { origin: 'https://other.example' },
					data: {}
				})
			).status(),
			403
		);
		sql(
			`INSERT INTO search_engines(id,group_key,name,key,url_template,placeholder,sort_order,is_enabled) SELECT 5000+value,CASE WHEN value=0 THEN 'onsite' WHEN value%2=0 THEN 'dev' ELSE 'general' END,'分页搜索源 '||printf('%03d',value),'source-'||value,CASE WHEN value=0 THEN '/search?q={query}' ELSE 'https://example.com/search?q={query}' END,'自定义提示 '||value,value*10,1 FROM json_each('${JSON.stringify(Array.from({ length: 225 }, (_, i) => i))}');`
		);
		await open('/admin/search-engines?page=999&edit=5000');
		assert.equal(await page.locator('.source-card').count(), 5);
		assert.match(await page.locator('.source-list').innerText(), /共 225 条/);
		assert.equal(await page.locator('input[name=key]').inputValue(), 'source-0');
		const before = snapshot();
		const keyword = '中文 & C++ / #?';
		await page
			.locator('input[name=urlTemplate]')
			.fill('https://example.com/search?q={query}&mode=all');
		await page.locator('input[name=sampleQuery]').fill(keyword);
		await page.getByRole('button', { name: '预览搜索链接', exact: true }).click();
		const target = await page.locator('.source-preview code').innerText();
		assert.equal(new URL(target).searchParams.get('q'), keyword);
		assert.equal(new URL(target).searchParams.get('mode'), 'all');
		assert.deepEqual(snapshot(), before, 'link preview must not save or change status/order');
		await page.getByRole('button', { name: '填入站内模板', exact: true }).click();
		assert.equal(await page.locator('input[name=urlTemplate]').inputValue(), '/search?q={query}');
		await page.getByRole('button', { name: '预览搜索链接', exact: true }).click();
		assert.match(await page.locator('.source-preview code').innerText(), /^\/search\?q=/);
		await page.locator('input[name=sampleQuery]').fill('下一条');
		await page.locator('.source-preview').waitFor({ state: 'hidden' });
		await page.locator('input[name=urlTemplate]').fill('https://{query}.example.com/');
		await page.getByRole('button', { name: '预览搜索链接', exact: true }).click();
		assert.match(await page.locator('.source-preview').innerText(), /不能改变目标站点/);
		await open('/admin/search-engines?q=' + encodeURIComponent('分页搜索源 224'));
		assert.equal(await page.locator('.source-card').count(), 1);
		await page.reload({ waitUntil: 'networkidle' });
		assert.equal(await page.locator('.source-card').count(), 1);
		await page.getByRole('link', { name: '编辑 / 预览', exact: true }).click();
		await page.locator('.source-editor').waitFor();
		await page.locator('input[name=key]').fill('source-0');
		await page.locator('input[name=placeholder]').fill('重复时保留此提示');
		await page.getByRole('button', { name: '保存搜索源', exact: true }).click();
		await page.getByRole('status').filter({ hasText: '唯一标识已被' }).waitFor();
		assert.equal(await page.locator('input[name=placeholder]').inputValue(), '重复时保留此提示');
		// Commit a create action locally, then discard the acknowledgement. A retry cannot duplicate the key.
		await open('/admin/search-engines?create=1');
		await page.getByLabel('搜索源名称', { exact: true }).fill('响应丢失的搜索源');
		await page.locator('input[name=key]').fill('source-loss');
		await page.locator('input[name=urlTemplate]').fill('/search?q={query}');
		let release;
		const held = new Promise((resolve) => (release = resolve));
		const actionRoute = (url) => url.pathname === '/admin/search-engines';
		await page.route(actionRoute, async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			await route.fetch();
			await held;
			await route.abort();
		});
		await page.getByRole('button', { name: '保存搜索源', exact: true }).click();
		await page.getByRole('button', { name: '保存中…', exact: true }).waitFor();
		assert.equal(await page.locator('input[name=name]').isDisabled(), true);
		release();
		await page.getByRole('status').filter({ hasText: '保存结果待核对' }).waitFor();
		assert.equal(sql("SELECT COUNT(*) n FROM search_engines WHERE key='source-loss'")[0].n, 1);
		assert.equal(await page.locator('input[name=name]').inputValue(), '响应丢失的搜索源');
		await page.unroute(actionRoute);
		await page.getByRole('button', { name: '保存搜索源', exact: true }).click();
		await page.getByRole('status').filter({ hasText: '唯一标识已被' }).waitFor();
		assert.equal(sql("SELECT COUNT(*) n FROM search_engines WHERE key='source-loss'")[0].n, 1);
		await open('/admin/search-engines?q=' + encodeURIComponent('分页搜索源 001'));
		await page.getByRole('button', { name: '设为首次默认', exact: true }).click();
		await page.waitForURL((url) => !url.search.includes('/move'));
		await page
			.locator('.source-summary .default-name')
			.filter({ hasText: '分页搜索源 001' })
			.waitFor();
		assert.equal(
			sql('SELECT id FROM search_engines ORDER BY sort_order,name,id LIMIT 1')[0].id,
			5001
		);
		assert.ok(page.url().includes('q='), 'move preserves filters');
		sql('UPDATE search_engines SET is_enabled=0 WHERE id NOT IN (5000,5001)');
		await home.goto(baseUrl, { waitUntil: 'networkidle' });
		assert.equal(
			await home.locator('.hero-search-form input[name=q]').getAttribute('placeholder'),
			'自定义提示 1'
		);
		await home.getByRole('button', { name: '分页搜索源 000', exact: true }).click();
		await home.reload({ waitUntil: 'networkidle' });
		assert.equal(
			await home.locator('.hero-search-form input[name=q]').getAttribute('placeholder'),
			'自定义提示 0'
		);
		await home.getByRole('button', { name: '分页搜索源 001', exact: true }).click();
		await home.route('https://example.com/search?**', (route) =>
			route.fulfill({ contentType: 'text/html', body: '<p>Local search navigation test</p>' })
		);
		await home.locator('.hero-search-form input[name=q]').fill(keyword);
		await home
			.locator('.hero-search-form')
			.getByRole('button', { name: '搜索', exact: true })
			.click();
		await home.waitForURL('https://example.com/search?**');
		assert.equal(new URL(home.url()).searchParams.get('q'), keyword);
		await home.goto(baseUrl, { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: '停用', exact: true }).click();
		await page.getByRole('button', { name: '启用', exact: true }).waitFor();
		await home.reload({ waitUntil: 'networkidle' });
		assert.equal(
			await home.locator('.hero-search-form input[name=q]').getAttribute('placeholder'),
			'自定义提示 0'
		);
		sql('UPDATE search_engines SET is_enabled=0');
		await home.reload({ waitUntil: 'networkidle' });
		await home.locator('.hero-search-form input[name=q]').fill('站内兜底');
		await home
			.locator('.hero-search-form')
			.getByRole('button', { name: '搜索', exact: true })
			.click();
		await home.waitForURL('**/search?q=**');
		assert.equal(new URL(home.url()).searchParams.get('q'), '站内兜底');
		// Native forms: preview, failed validation, save and confirmed deletion.
		const native = await browser.newContext({ javaScriptEnabled: false });
		try {
			await native.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
			const np = await native.newPage();
			await np.goto(baseUrl);
			await np.locator('.hero-search-form input[name=q]').fill('原生站内搜索');
			await np
				.locator('.hero-search-form')
				.getByRole('button', { name: '搜索', exact: true })
				.click();
			await np.waitForURL('**/search?q=**');
			assert.equal(new URL(np.url()).searchParams.get('q'), '原生站内搜索');
			await np.goto(baseUrl + '/admin/search-engines?create=1');
			assert.equal(await np.getByRole('button', { name: '填入站内模板', exact: true }).count(), 0);
			await np.locator('input[name=name]').fill('原生搜索源');
			await np.locator('input[name=key]').fill('native-source');
			await np.locator('input[name=urlTemplate]').fill('/search?q={query}');
			await np.locator('input[name=placeholder]').fill('原生自定义提示');
			await np.getByRole('button', { name: '预览搜索链接', exact: true }).click();
			await np.locator('.source-preview').waitFor();
			assert.equal(sql("SELECT COUNT(*) n FROM search_engines WHERE key='native-source'")[0].n, 0);
			assert.equal(await np.locator('input[name=name]').inputValue(), '原生搜索源');
			await np.locator('input[name=urlTemplate]').fill('http://127.0.0.1/?q={query}');
			await np.getByRole('button', { name: '保存搜索源', exact: true }).click();
			await np.getByRole('status').filter({ hasText: '请检查表单' }).waitFor();
			assert.equal(await np.locator('input[name=placeholder]').inputValue(), '原生自定义提示');
			await np.locator('input[name=urlTemplate]').fill('/search?q={query}');
			await np.getByRole('button', { name: '保存搜索源', exact: true }).click();
			await np.waitForURL(
				(url) => url.pathname === '/admin/search-engines' && !url.searchParams.has('create')
			);
			assert.equal(
				sql("SELECT placeholder FROM search_engines WHERE key='native-source'")[0].placeholder,
				'原生自定义提示'
			);
			await np.goto(baseUrl + '/admin/search-engines?q=native-source');
			await np.getByText('删除', { exact: true }).click();
			await np.getByLabel('确认删除“原生搜索源”；保留此源可选择停用。', { exact: true }).check();
			await np.getByRole('button', { name: '确认删除', exact: true }).click();
			assert.equal(sql("SELECT COUNT(*) n FROM search_engines WHERE key='native-source'")[0].n, 0);
		} finally {
			await native.close();
		}
		sql('UPDATE search_engines SET is_enabled=1 WHERE id IN (5000,5001)');
		for (const theme of ['light', 'dark'])
			for (const width of [320, 375, 768, 1366, 1920])
				for (const name of ['list', 'editor', 'public']) {
					const target = name === 'public' ? home : page;
					await target.setViewportSize({ width, height: 1000 });
					await target.goto(
						baseUrl +
							(name === 'public'
								? '/'
								: name === 'list'
									? '/admin/search-engines?q=' + encodeURIComponent('分页搜索源 00')
									: '/admin/search-engines?q=source-loss&edit=5000'),
						{ waitUntil: 'networkidle' }
					);
					if ((await target.getByLabel('切换深色模式').isChecked()) !== (theme === 'dark'))
						await target.locator('.theme-toggle').click();
					await target.evaluate(() => document.fonts.ready);
					if (name === 'editor') {
						await target.getByRole('button', { name: '预览搜索链接', exact: true }).click();
						await target.locator('.source-preview').waitFor();
					}
					assert.ok(
						await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
						`${name} ${width} overflow`
					);
					if (name !== 'public') {
						const dimensions = await target
							.locator(
								'.source-card button,.source-card a,.source-card summary,.source-editor button,.source-pagination a'
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
						const ratio = await target
							.locator('.source-note')
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
						assert.ok(ratio >= 4.5, `${theme} text contrast ${ratio}`);
					}
					if (screenshots) {
						mkdirSync(screenshots, { recursive: true });
						await target.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
						await target.screenshot({
							path: join(screenshots, `search-sources-${name}-${width}-${theme}.png`),
							fullPage: true
						});
					}
					layouts++;
				}
		assert.deepEqual(errors, [], 'search sources browser runtime errors');
		console.log(
			`Search sources: full pagination/filters, read-only encoded previews, duplicate and lost-response preservation, atomic default/order, remembered-source fallback, homepage placeholders, native forms and ${layouts} CJK layouts passed.`
		);
		return layouts;
	} catch (error) {
		if (screenshots) {
			mkdirSync(screenshots, { recursive: true });
			await page.screenshot({
				path: join(screenshots, 'search-sources-failure.png'),
				fullPage: true
			});
		}
		throw error;
	} finally {
		await admin.close();
		await user.close();
		await anon.close();
	}
}
