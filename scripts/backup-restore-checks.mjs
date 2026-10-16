import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
// Only the temporary LOCAL database/Worker owned by the caller may be restored.
export async function checkBackupRestore({
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
	const context = await browser.newContext();
	await context.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
	const page = await context.newPage(),
		errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const previewUrl = baseUrl + '/api/admin/backup/preview',
		restoreUrl = baseUrl + '/api/admin/backup/restore';
	const post = (url, data, headers = {}) =>
		context.request.post(url, { headers: { origin: baseUrl, ...headers }, data });
	const input = () => page.locator('.restore-workspace input[type=file]');
	const check = () => page.getByRole('button', { name: '检查并预览', exact: true });
	const confirm = () => page.getByRole('button', { name: '确认恢复', exact: true });
	const checkbox = () => page.locator('.restore-confirm input[type=checkbox]');
	const upload = async (value) => {
		await input().setInputFiles({
			name: 'restore-review.json',
			mimeType: 'application/json',
			buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
		});
	};
	const open = async () => {
		assert.equal(
			(await page.goto(baseUrl + '/admin/import-export', { waitUntil: 'networkidle' })).status(),
			200
		);
		await input().waitFor();
	};
	const review = async (backup) => {
		await upload(backup);
		await check().click();
		await page.locator('.restore-preview').waitFor();
	};
	try {
		const exported = await context.request.get(baseUrl + '/api/admin/backup');
		assert.equal(exported.status(), 200);
		assert.match(exported.headers()['content-disposition'], /attachment/);
		const base = await exported.json(),
			backup = structuredClone(base);
		const item = backup.items.find((row) => row.type === 'site');
		assert.ok(item);
		const original = sql(
			`SELECT * FROM items WHERE type='site' AND slug='${item.slug.replaceAll("'", "''")}'`
		)[0];
		item.title = '备份恢复验收后的标题';
		backup.categories.push({
			type: 'site',
			slug: 'backup-added',
			parent: null,
			name: '恢复新增分类',
			icon: null,
			description: null,
			sortOrder: 0,
			isVisible: true
		});
		backup.tags.push({ type: 'site', slug: 'backup-tag', name: '恢复新增标签', description: null });
		for (let n = 0; n < 225; n++)
			backup.items.push({
				...item,
				slug: 'backup-item-' + n,
				title: '备份预览新增内容 ' + n,
				category: { type: 'site', slug: 'backup-added' },
				tags: [{ type: 'site', slug: 'backup-tag' }]
			});
		backup.homeModules = [];
		backup.searchEngines = [];
		backup.hotSources = [];
		backup.settings = {
			site: { title: '恢复测试站点' },
			plain: '保留字符串值',
			enabled: true,
			nullable: null
		};
		const anonymous = await browser.newContext(),
			user = await browser.newContext();
		try {
			await user.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
			for (const url of [previewUrl, restoreUrl]) {
				assert.equal(
					(
						await anonymous.request.post(url, { data: backup, headers: { origin: baseUrl } })
					).status(),
					401
				);
				assert.equal(
					(await user.request.post(url, { data: backup, headers: { origin: baseUrl } })).status(),
					403
				);
			}
		} finally {
			await anonymous.close();
			await user.close();
		}
		assert.equal(
			(await post(previewUrl, backup, { origin: 'https://foreign.example' })).status(),
			403
		);
		assert.equal((await post(restoreUrl, backup)).status(), 428);
		assert.equal(
			(
				await post(previewUrl, 'x'.repeat(2 * 1024 * 1024 + 1), {
					'content-type': 'application/json'
				})
			).status(),
			413
		);
		await open();
		await page.route(baseUrl + '/api/admin/backup/scheduled', (route) => route.abort('failed'));
		await page.getByRole('button', { name: '刷新列表', exact: true }).click();
		await page.getByRole('status').filter({ hasText: '列表刷新失败' }).waitFor();
		await page.unroute(baseUrl + '/api/admin/backup/scheduled');
		await page.getByRole('button', { name: '刷新列表', exact: true }).click();
		await page.getByRole('status').filter({ hasText: '列表刷新失败' }).waitFor({ state: 'hidden' });
		await input().setInputFiles({
			name: 'too-large.json',
			mimeType: 'application/json',
			buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 32)
		});
		await check().click();
		await page.getByRole('status').filter({ hasText: '备份不能超过 2 MiB' }).waitFor();
		await upload('{broken');
		await check().click();
		await page.getByRole('status').filter({ hasText: '有效的 UTF-8 JSON' }).waitFor();
		assert.equal(await check().isEnabled(), true);
		assert.equal(await input().evaluate((el) => el.files.length), 1);
		await upload({ ...base, categories: [null] });
		await check().click();
		await page.getByRole('alert').filter({ hasText: 'categories[1]' }).waitFor();
		assert.equal(await confirm().count(), 0);
		await page.route(previewUrl, (route) => route.abort('failed'));
		await upload(backup);
		await check().click();
		await page.waitForFunction(() => !document.querySelector('.restore-workspace button').disabled);
		assert.equal(await input().evaluate((el) => el.files.length), 1);
		await page.unroute(previewUrl);
		await check().click();
		await page.locator('.restore-preview').waitFor();
		assert.equal(await confirm().isEnabled(), false);
		assert.equal(sql(`SELECT title FROM items WHERE id=${original.id}`)[0].title, original.title);
		await page.getByRole('combobox', { name: '范围', exact: true }).selectOption('items');
		assert.match(await page.locator('.restore-preview').innerText(), /共 226 个项目/);
		await page.getByRole('button', { name: '下一页', exact: true }).click();
		assert.match(await page.locator('.preview-pages').innerText(), /2 \/ 12/);
		await page.getByRole('searchbox', { name: '查找项目', exact: true }).fill('backup-item-224');
		assert.equal(await page.locator('.backup-change-list li').count(), 1);
		assert.match(await page.locator('.backup-change-list').innerText(), /备份预览新增内容 224/);
		// Re-selecting a file clears old confirmation and preview, including identical filenames.
		await checkbox().check();
		await upload(backup);
		assert.equal(await page.locator('.restore-preview').count(), 0);
		await check().click();
		await page.locator('.restore-preview').waitFor();
		assert.equal(await checkbox().isChecked(), false);
		// A real database change invalidates the reviewed state before writing.
		sql(`UPDATE items SET title='预览后的管理员修改' WHERE id=${original.id}`);
		await checkbox().check();
		await confirm().click();
		await page.getByRole('status').filter({ hasText: '站点内容已变化' }).waitFor();
		assert.equal(await page.locator('.restore-preview').count(), 0);
		assert.equal(
			sql(`SELECT title FROM items WHERE id=${original.id}`)[0].title,
			'预览后的管理员修改'
		);
		await check().click();
		await page.locator('.restore-preview').waitFor();
		let release, entered;
		const waiting = new Promise((done) => (entered = done)),
			gate = new Promise((done) => (release = done));
		await page.route(restoreUrl, async (route) => {
			entered();
			await gate;
			await route.continue();
		});
		await checkbox().check();
		await confirm().click();
		await waiting;
		const disabled = await input().isDisabled();
		release();
		assert.equal(disabled, true);
		await page.getByRole('status').filter({ hasText: '恢复已确认完成' }).waitFor();
		await page.unroute(restoreUrl);
		assert.equal(sql("SELECT COUNT(*) n FROM items WHERE slug LIKE 'backup-item-%'")[0].n, 225);
		const saved = sql(
			`SELECT id,author_id,icon_file_id,cover_file_id,title FROM items WHERE id=${original.id}`
		)[0];
		assert.deepEqual(saved, {
			id: original.id,
			author_id: original.author_id,
			icon_file_id: original.icon_file_id,
			cover_file_id: original.cover_file_id,
			title: '备份恢复验收后的标题'
		});
		assert.equal(sql('SELECT COUNT(*) n FROM home_modules')[0].n, 0);
		const noChange = await post(previewUrl, backup);
		assert.equal((await noChange.json()).preview.hasChanges, false);
		console.log(
			'Backup restore: permission, validation, full preview pagination, stale-state rejection and actual atomic restore passed.'
		);
		// Drop the response after the server committed. The UI must require a fresh check.
		const next = structuredClone(backup);
		next.items[0].title = '恢复成功但响应丢失';
		await open();
		await review(next);
		const proof = (await (await post(previewUrl, next)).json()).preview;
		await page.route(restoreUrl, async (route) => {
			const response = await route.fetch();
			assert.equal(response.status(), 200);
			await route.abort('failed');
		});
		await checkbox().check();
		await confirm().click();
		await page.getByRole('status').filter({ hasText: '恢复结果未确认' }).waitFor();
		assert.equal(await confirm().isEnabled(), false);
		await page.unroute(restoreUrl);
		const repeat = await post(restoreUrl, next, {
			'x-backup-digest': proof.backupDigest,
			'x-backup-state': proof.stateDigest,
			'x-backup-confirmed': 'yes'
		});
		assert.equal(repeat.status(), 409);
		await page.getByRole('button', { name: '重新检查并核对' }).click();
		await page.getByRole('status').filter({ hasText: '无需恢复' }).waitFor();
		assert.equal(await confirm().count(), 0);
		const native = await browser.newContext({ javaScriptEnabled: false });
		try {
			await native.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
			const tab = await native.newPage();
			await tab.goto(baseUrl + '/admin/import-export');
			await tab
				.getByText('请启用 JavaScript 后检查和恢复备份。上方备份下载仍可使用。', { exact: true })
				.waitFor();
			assert.equal(await tab.getByRole('button', { name: '确认恢复' }).count(), 0);
			assert.ok(await tab.getByRole('link', { name: '下载当前 JSON 备份' }).isVisible());
		} finally {
			await native.close();
		}
		if (screenshots) mkdirSync(screenshots, { recursive: true });
		let layouts = 0;
		const remaining = structuredClone(next);
		remaining.items[0].title = '用于布局核验的待恢复标题';
		for (const width of [320, 375, 768, 1366, 1920])
			for (const dark of [false, true]) {
				await page.setViewportSize({ width, height: 900 });
				await open();
				const toggle = page.getByLabel('切换深色模式');
				if ((await toggle.isChecked()) !== dark) await page.locator('.theme-toggle').click();
				await review(remaining);
				await page.evaluate(() => document.fonts.ready);
				const sample = await page.evaluate(() => {
					const lum = (color) => {
						const rgb = color
							.match(/[\d.]+/g)
							.slice(0, 3)
							.map(Number)
							.map((n) => n / 255)
							.map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
						return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
					};
					const ratios = [
						...document.querySelectorAll(
							'.backup-muted,.backup-notice p,.backup-change-list strong,.backup-change-list p,.restore-summary td,.restore-summary th,.restore-confirm label,.preview-filters label'
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
							const v = [
								lum(getComputedStyle(el).color),
								lum(getComputedStyle(bg).backgroundColor)
							].sort((a, b) => b - a);
							return {
								text: el.textContent.trim().slice(0, 35),
								ratio: (v[0] + 0.05) / (v[1] + 0.05)
							};
						});
					return {
						overflow: document.documentElement.scrollWidth > innerWidth + 1,
						ratios,
						controls: [
							...document.querySelectorAll(
								'.restore-workspace button,.restore-workspace select,.restore-workspace input:not([type=checkbox]),.backup-library button'
							)
						]
							.filter((el) => el.getClientRects().length)
							.map((el) => el.getBoundingClientRect().height)
					};
				});
				assert.equal(sample.overflow, false, JSON.stringify({ width, dark }));
				for (const r of sample.ratios)
					assert.ok(r.ratio >= 4.5, JSON.stringify({ width, dark, ...r }));
				assert.ok(sample.controls.every((n) => n >= 43.5));
				await page.getByRole('region', { name: '恢复范围与数量，可横向滚动' }).focus();
				if (width < 768) {
					await page.keyboard.press('ArrowRight');
					await page.waitForFunction(
						() => document.querySelector('.restore-summary').scrollLeft > 0
					);
				}
				if (screenshots) {
					await page
						.locator('.restore-preview')
						.evaluate((el) => el.scrollIntoView({ block: 'start' }));
					await page.screenshot({
						path: join(screenshots, `backup-preview-${width}-${dark ? 'dark' : 'light'}.png`)
					});
				}
				layouts++;
			}
		assert.deepEqual(errors, []);
		console.log(
			`Backup restore: uncertain response protection, native download fallback, keyboard tables and ${layouts} CJK layouts passed.`
		);
		return layouts;
	} catch (error) {
		if (screenshots) {
			mkdirSync(screenshots, { recursive: true });
			await page.screenshot({ path: join(screenshots, 'backup-failure.png') });
		}
		throw error;
	} finally {
		await context.close();
	}
}
