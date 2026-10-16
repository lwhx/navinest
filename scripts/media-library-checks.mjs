import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Only the caller-owned isolated local Worker/D1/R2 may be used.
export async function checkMediaLibrary({
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
	const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
	const original = sql('SELECT id,title,icon_file_id,cover_file_id FROM items WHERE id=1')[0];
	const profile = sql('SELECT avatar_file_id,cover_file_id FROM users WHERE id=2')[0];
	const seed = Array.from(
		{ length: 225 },
		(_, i) =>
			`(${9000 + i},2,'FILES','qa-media-${i}.png','${i % 2 ? 'image/webp' : 'image/png'}',${i + 10},'2026-10-01 12:00:00')`
	).join(',');
	sql(
		`INSERT INTO files(id,user_id,bucket,object_key,mime_type,size,created_at) VALUES ${seed}; UPDATE users SET avatar_file_id=9000,cover_file_id=9001 WHERE id=2; UPDATE items SET icon_file_id=9002 WHERE id=1; INSERT INTO submissions(id,user_id,type,title,payload_json,status) VALUES(90000,2,'site','媒体专项待审','{"iconFileId":9003}','pending'),(90001,2,'site','媒体专项处理中','{"iconFileId":9004}','reviewing'),(90002,2,'site','媒体专项历史损坏','invalid-json','pending')`
	);
	const context = await browser.newContext();
	await context.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
	const user = await browser.newContext();
	await user.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
	const page = await context.newPage(),
		errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('dialog', (dialog) => dialog.accept());
	const image = {
		name: 'local-media-fixture.png',
		mimeType: 'image/png',
		buffer: Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV7sAAAAASUVORK5CYII=',
			'base64'
		)
	};
	const picker = () =>
		page.locator('.media-picker').filter({ has: page.locator('input[name="iconFileId"]') });
	try {
		assert.equal((await user.request.get(baseUrl + '/api/admin/files')).status(), 403);
		await page.goto(baseUrl + '/admin/files?q=qa-media', { waitUntil: 'networkidle' });
		assert.equal(await page.locator('.library-card').count(), 24);
		assert.match(await page.locator('.library-summary').innerText(), /225/);
		await page.getByRole('link', { name: '下一页', exact: true }).click();
		await page.waitForURL((url) => url.searchParams.get('page') === '2');
		await page.reload();
		assert.equal(await page.getByLabel('搜索图片', { exact: true }).inputValue(), 'qa-media');
		const result = await (
			await context.request.get(baseUrl + '/api/admin/files?q=qa-media&page=999')
		).json();
		assert.equal(result.page.total, 225);
		assert.equal(result.page.filters.page, 10);
		assert.equal(result.data.length, 9);
		await page.goto(baseUrl + '/admin/files?q=qa-media&usage=used', { waitUntil: 'networkidle' });
		assert.equal(await page.locator('.library-card').count(), 5);
		assert.equal(
			await page.getByRole('button', { name: '删除未引用图片', exact: true }).count(),
			0
		);
		for (const id of [9000, 9001, 9002, 9003, 9004])
			assert.equal(
				(await context.request.delete(baseUrl + '/api/admin/files/' + id)).status(),
				409
			);
		assert.equal((await user.request.delete(baseUrl + '/api/user/files/9004')).status(), 409);
		await page.locator('[data-file-id="9004"] .file-references summary').click();
		assert.match(await page.locator('[data-file-id="9004"]').innerText(), /媒体专项处理中/);
		await page.goto(baseUrl + '/admin/files?q=9005', { waitUntil: 'networkidle' });
		sql('UPDATE users SET cover_file_id=9005 WHERE id=2');
		await page.getByRole('button', { name: '删除未引用图片', exact: true }).click();
		await page.getByRole('alert').filter({ hasText: '引用' }).waitFor();
		assert.equal(sql('SELECT id FROM files WHERE id=9005').length, 1);
		sql('UPDATE users SET cover_file_id=9001 WHERE id=2');
		await page.goto(baseUrl + '/admin/files?q=qa-media', { waitUntil: 'networkidle' });
		await page.getByText('上传新图片', { exact: true }).click();
		await page.getByLabel('上传图片', { exact: true }).setInputFiles(image);
		await page.route('**/api/admin/files', (route) =>
			route.fulfill({ status: 503, json: { error: '隔离测试：存储暂不可用' } })
		);
		await page.getByRole('button', { name: '上传所选图片', exact: true }).click();
		await page.getByRole('alert').filter({ hasText: '隔离测试' }).waitFor();
		assert.equal(
			await page.getByLabel('上传图片', { exact: true }).evaluate((el) => el.files[0].name),
			image.name
		);
		await page.unroute('**/api/admin/files');
		const uploaded = page.waitForResponse(
			(response) =>
				response.url() === baseUrl + '/api/admin/files' && response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: '重新上传', exact: true }).click();
		const uploadedId = (await (await uploaded).json()).data.id;
		await page
			.getByRole('status')
			.filter({ hasText: `上传成功，图片 #${uploadedId}` })
			.waitFor();
		await page.goto(baseUrl + '/admin/files?q=' + uploadedId, { waitUntil: 'networkidle' });
		const trigger = page.getByRole('button', { name: `预览图片 #${uploadedId}`, exact: true });
		await trigger.click();
		const preview = page.getByRole('dialog', { name: `图片预览 · #${uploadedId}`, exact: true });
		await preview.waitFor();
		assert.ok(await preview.locator('img').evaluate((el) => el.naturalWidth > 0));
		await page.keyboard.press('Escape');
		await preview.waitFor({ state: 'hidden' });
		assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
		await page.route(baseUrl + '/api/admin/files/' + uploadedId, (route) =>
			route.request().method() === 'DELETE'
				? route.fulfill({ status: 503, json: { error: '隔离测试：删除失败' } })
				: route.continue()
		);
		await page.getByRole('button', { name: '删除未引用图片', exact: true }).click();
		await page.getByRole('alert').filter({ hasText: '隔离测试：删除失败' }).waitFor();
		assert.equal(await page.locator('.library-card').count(), 1);
		await page.unroute(baseUrl + '/api/admin/files/' + uploadedId);
		await page.getByRole('button', { name: '删除未引用图片', exact: true }).click();
		await page.getByRole('status').filter({ hasText: '已删除' }).waitFor();
		await page.locator('.library-card').waitFor({ state: 'hidden' });
		assert.equal(
			(await context.request.get(baseUrl + '/api/admin/files/' + uploadedId)).status(),
			404
		);

		await page.goto(baseUrl + '/admin/items?edit=1', { waitUntil: 'networkidle' });
		await page.getByText('图标与封面', { exact: true }).click();
		assert.equal(await picker().locator('input[type="hidden"]').inputValue(), '9002');
		await page.getByLabel('标题', { exact: true }).fill('媒体编辑验收');
		await page.route('**/api/admin/files?*', (route) =>
			route.fulfill({ status: 503, json: { error: '隔离测试：列表读取失败' } })
		);
		await picker().getByRole('button', { name: '替换图片', exact: true }).click();
		await picker().getByRole('alert').waitFor();
		assert.equal(await picker().locator('input[type="hidden"]').inputValue(), '9002');
		await page.unroute('**/api/admin/files?*');
		await picker().getByRole('button', { name: '重试加载图片', exact: true }).click();
		await picker().locator('.media-grid button').first().waitFor();
		await picker().getByLabel('搜索图片', { exact: true }).fill('9000');
		await picker().getByLabel('搜索图片', { exact: true }).press('Enter');
		await picker().getByRole('button', { name: '选择图片 #9000', exact: true }).click();
		assert.equal(await picker().locator('input[type="hidden"]').inputValue(), '9000');
		assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '媒体编辑验收');
		await picker().getByRole('button', { name: '预览当前内容图标', exact: true }).click();
		await page.getByRole('dialog', { name: '图片预览 · #9000', exact: true }).waitFor();
		await page.keyboard.press('Escape');
		assert.equal(await page.getByRole('dialog').count(), 1);
		await picker().getByRole('button', { name: '移除', exact: true }).click();
		await picker().getByRole('button', { name: '选择图片', exact: true }).click();
		await picker().getByLabel('上传新的内容图标', { exact: true }).setInputFiles(image);
		let release, started;
		const hold = new Promise((resolve) => (release = resolve)),
			seen = new Promise((resolve) => (started = resolve));
		await page.route('**/api/admin/files', async (route) => {
			started();
			await hold;
			await route.fulfill({ response: await route.fetch() });
		});
		const direct = page.waitForResponse(
			(response) =>
				response.url() === baseUrl + '/api/admin/files' && response.request().method() === 'POST'
		);
		direct.catch(() => {});
		await picker().getByRole('button', { name: '上传所选图片', exact: true }).click();
		await Promise.race([seen, direct]);
		const saveDisabled = await page.locator('.editor-savebar button[type="submit"]').isDisabled();
		const closeDisabled = await page
			.getByRole('button', { name: '关闭编辑窗口', exact: true })
			.isDisabled();
		release();
		assert.equal(saveDisabled, true);
		assert.equal(closeDisabled, true);
		const editorId = (await (await direct).json()).data.id;
		await picker()
			.getByRole('status')
			.filter({ hasText: `上传成功，图片 #${editorId}` })
			.waitFor();
		await page.unroute('**/api/admin/files');
		assert.equal(await picker().locator('input[type="hidden"]').inputValue(), String(editorId));
		await page.getByRole('button', { name: '保存内容', exact: true }).click();
		await page.getByRole('dialog').waitFor({ state: 'hidden' });
		assert.equal(sql('SELECT icon_file_id FROM items WHERE id=1')[0].icon_file_id, editorId);
		await page.goto(baseUrl + '/admin/items?edit=1', { waitUntil: 'networkidle' });
		await page.getByText('图标与封面', { exact: true }).click();
		assert.equal(await picker().locator('input[type="hidden"]').inputValue(), String(editorId));
		await page.getByRole('button', { name: '关闭编辑窗口', exact: true }).click();

		console.log(
			'Media library: reference protection, upload retry, nested preview and editor upload/save passed.'
		);
		const native = await browser.newContext({ javaScriptEnabled: false });
		try {
			await native.addCookies(await context.cookies());
			const tab = await native.newPage();
			await tab.goto(baseUrl + '/admin/files?q=9000');
			assert.equal(
				await tab.getByRole('button', { name: '删除未引用图片', exact: true }).count(),
				0
			);
			await tab.goto(baseUrl + '/admin/files');
			await tab.getByText('上传新图片', { exact: true }).click();
			await tab.getByLabel('图片文件', { exact: true }).setInputFiles(image);
			await tab.getByRole('button', { name: '上传文件', exact: true }).click();
			await tab.waitForURL(
				(url) => url.pathname === '/admin/files' && !url.search.includes('/upload')
			);
			const nativeId = sql('SELECT MAX(id) id FROM files')[0].id;
			await tab.goto(baseUrl + '/admin/files?q=' + nativeId);
			await tab.getByLabel('确认永久删除原文件', { exact: true }).check();
			await tab.getByRole('button', { name: '删除未引用图片', exact: true }).click();
			await tab.getByText('没有匹配的图片', { exact: true }).waitFor();
			assert.equal(sql(`SELECT id FROM files WHERE id=${nativeId}`).length, 0);
		} finally {
			await native.close();
		}

		console.log('Media library: native upload and filtered deletion passed.');
		if (screenshots) mkdirSync(screenshots, { recursive: true });
		let layouts = 0;
		for (const width of [320, 375, 768, 1366, 1920])
			for (const dark of [false, true])
				for (const view of ['library', 'picker']) {
					await page.setViewportSize({ width, height: 900 });
					await page.goto(
						baseUrl +
							(view === 'library' ? '/admin/files?q=qa-media&usage=used' : '/admin/items?edit=1'),
						{ waitUntil: 'networkidle' }
					);
					if ((await page.getByLabel('切换深色模式').isChecked()) !== dark)
						await page.locator('.theme-toggle').click();
					if (view === 'picker') {
						await page.getByText('图标与封面', { exact: true }).click();
						await picker().getByRole('button', { name: '替换图片', exact: true }).click();
						await picker().locator('.media-grid button').first().waitFor();
					}
					const sample = await page.evaluate(() => ({
						overflow: document.documentElement.scrollWidth > innerWidth + 1,
						controls: [
							...document.querySelectorAll(
								'.library-filters input,.library-filters select,.library-filters button,.library-pagination a,.library-body button,.media-picker button,.media-browser input,.media-browser select'
							)
						]
							.filter((el) => el.getClientRects().length)
							.map((el) => ({
								text: el.textContent || el.name,
								height: el.getBoundingClientRect().height
							}))
					}));
					assert.equal(sample.overflow, false, JSON.stringify({ width, dark, view, sample }));
					assert.ok(
						sample.controls.every((c) => c.height >= 43.5),
						JSON.stringify({ width, dark, view, sample })
					);
					const contrast = await page.evaluate(() => {
						const lum = (color) => {
							const c = color
								.match(/[\d.]+/g)
								.slice(0, 3)
								.map(Number)
								.map((n) => n / 255)
								.map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
							return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
						};
						return [
							...document.querySelectorAll(
								'.library-summary p,.library-heading h2,.library-body p,.library-body time,.library-heading span,.browser-count,.media-grid small'
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
								const x = [
									lum(getComputedStyle(el).color),
									lum(getComputedStyle(bg).backgroundColor)
								].sort((a, b) => b - a);
								return {
									text: el.textContent.trim().slice(0, 30),
									ratio: (x[0] + 0.05) / (x[1] + 0.05)
								};
							});
					});
					for (const c of contrast)
						assert.ok(c.ratio >= 4.5, JSON.stringify({ width, dark, view, ...c }));
					if (screenshots)
						await page.screenshot({
							path: join(screenshots, `media-${view}-${width}-${dark ? 'dark' : 'light'}.png`),
							animations: 'disabled'
						});
					layouts++;
				}
		assert.deepEqual(errors, []);
		console.log(
			`Media library: full pagination/search/filtering, all reference types, guarded deletion, upload retry/progress, selected image preservation, nested preview keyboard focus, direct editor upload/save, native forms and ${layouts} themed layouts passed.`
		);
		return layouts;
	} catch (error) {
		if (screenshots) {
			mkdirSync(screenshots, { recursive: true });
			await page.screenshot({ path: join(screenshots, 'media-failure.png') });
			writeFileSync(join(screenshots, 'media-failure.html'), await page.content());
		}
		throw error;
	} finally {
		await context.close();
		await user.close();
		sql(
			`UPDATE users SET avatar_file_id=${profile.avatar_file_id ?? 'NULL'},cover_file_id=${profile.cover_file_id ?? 'NULL'} WHERE id=2; UPDATE items SET title=${quote(original.title)},icon_file_id=${original.icon_file_id ?? 'NULL'},cover_file_id=${original.cover_file_id ?? 'NULL'} WHERE id=1; DELETE FROM submissions WHERE id IN (90000,90001,90002); DELETE FROM files WHERE id BETWEEN 9000 AND 9224`
		);
	}
}
