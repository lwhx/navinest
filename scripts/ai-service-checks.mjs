import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// All writes use the parent smoke script's owned local Worker and database.
export async function checkAiServices({
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
	page.on('pageerror', (error) => errors.push(error.message));
	const endpoint = baseUrl + '/api/admin/ai-providers/9901/test';
	let layouts = 0;
	try {
		assert.equal(
			(await anon.request.post(endpoint, { headers: { origin: baseUrl } })).status(),
			401
		);
		assert.equal(
			(await user.request.post(endpoint, { headers: { origin: baseUrl } })).status(),
			403
		);
		assert.equal(
			(
				await admin.request.post(endpoint, { headers: { origin: 'https://untrusted.example' } })
			).status(),
			403
		);
		await page.goto(baseUrl + '/admin/ai-providers?create=1', { waitUntil: 'networkidle' });
		await page.getByLabel('服务名称', { exact: true }).fill('用于流程检查的主服务');
		await page.getByLabel('模型名称', { exact: true }).fill('test-model');
		await page.getByLabel('API Base URL', { exact: true }).fill('https://api.example.com/v1');
		await page.getByLabel('API Key', { exact: true }).fill('local-test-secret-key');
		assert.equal(await page.getByLabel('请求超时（毫秒）', { exact: true }).isVisible(), false);
		await page.getByText('高级参数', { exact: true }).click();
		assert.equal(await page.getByLabel('请求超时（毫秒）', { exact: true }).isVisible(), true);
		await page.getByRole('button', { name: '保存配置', exact: true }).click();
		await page.waitForURL((url) => url.searchParams.has('created'));
		const id = Number(new URL(page.url()).searchParams.get('edit'));
		assert.ok(id > 0);
		assert.equal(await page.getByLabel(/API Key/).inputValue(), '');
		assert.equal(
			await page
				.locator('.admin-table')
				.getByRole('button', { name: '启用', exact: true })
				.isDisabled(),
			true
		);
		assert.equal(
			sql(`SELECT test_status,is_enabled FROM ai_providers WHERE id=${id}`)[0].is_enabled,
			0
		);
		await page.getByLabel('模型名称', { exact: true }).fill('尚未保存的模型');
		await page.getByRole('status').filter({ hasText: '有未保存的修改' }).waitFor();
		assert.equal(
			await page.getByRole('button', { name: '测试已保存配置', exact: true }).isDisabled(),
			true
		);
		await page.getByLabel('模型名称', { exact: true }).fill('test-model');
		// Failed validation retains the entered secret in this browser; the response never returns it.
		await page.getByLabel('API Base URL', { exact: true }).fill('http://127.0.0.1/v1');
		await page.getByLabel(/API Key/).fill('not-returned-secret');
		const responsePromise = page.waitForResponse(
			(response) =>
				response.url().includes('/admin/ai-providers?edit=') &&
				response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: '保存配置', exact: true }).click();
		const response = await responsePromise;
		assert.ok(!(await response.text()).includes('not-returned-secret'));
		await page
			.getByRole('alert')
			.filter({ hasText: /私网|地址/ })
			.waitFor();
		assert.equal(await page.getByLabel(/API Key/).inputValue(), 'not-returned-secret');
		assert.equal(
			await page.getByLabel('API Base URL', { exact: true }).inputValue(),
			'http://127.0.0.1/v1'
		);
		await page.getByLabel('API Base URL', { exact: true }).fill('https://api.example.com/v1');
		await page.getByLabel(/API Key/).fill('');
		for (const code of ['address', 'authentication', 'timeout', 'invalid_response']) {
			await page.route('**/api/admin/ai-providers/*/test', (route) =>
				route.fulfill({
					status: 422,
					json: { error: '安全测试提示', code, latencyMs: 20, historySaved: true }
				})
			);
			await page.getByRole('button', { name: '测试已保存配置', exact: true }).click();
			await page.getByRole('alert').filter({ hasText: '安全测试提示' }).waitFor();
			assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'test-model');
			await page.unroute('**/api/admin/ai-providers/*/test');
		}
		// The real API encryption failure is local and makes no external request.
		sql(`UPDATE ai_providers SET api_key_ciphertext='invalid' WHERE id=${id}`);
		await page.getByRole('button', { name: '测试已保存配置', exact: true }).click();
		await page.getByRole('alert').filter({ hasText: '解密失败' }).waitFor();
		assert.equal(
			sql('SELECT error_code FROM ai_service_calls ORDER BY id DESC LIMIT 1')[0].error_code,
			'configuration'
		);
		// Explicit activation is exercised against real SQL, with test approval seeded locally.
		sql(`UPDATE ai_providers SET test_status='success',test_error=NULL WHERE id=${id}`);
		await page.reload({ waitUntil: 'networkidle' });
		await page.getByRole('button', { name: '启用', exact: true }).click();
		await page.waitForURL('**/admin/ai-providers?enabled=1');
		assert.ok((await page.locator('.ai-current').innerText()).includes('用于流程检查的主服务'));
		assert.equal(sql('SELECT COUNT(*) count FROM ai_providers WHERE is_enabled=1')[0].count, 1);
		await page.getByRole('link', { name: '编辑', exact: true }).click();
		await page.getByLabel('模型名称', { exact: true }).fill('new-model');
		await page.getByRole('button', { name: '保存配置', exact: true }).click();
		await page.waitForURL((url) => url.searchParams.has('updated'));
		assert.ok((await page.locator('.ai-current').innerText()).includes('未启用 AI 服务'));
		assert.equal(
			sql(`SELECT test_status FROM ai_providers WHERE id=${id}`)[0].test_status,
			'untested'
		);
		sql(
			Array.from(
				{ length: 23 },
				() =>
					`INSERT INTO ai_service_calls(provider_id,provider_name,model,origin,stage,outcome,error_code,duration_ms,ai_duration_ms) VALUES(${id},'中文主服务','旧模型','submission','generation','failed','timeout',120,100)`
			).join(';')
		);
		sql(
			"INSERT INTO ai_service_calls(origin,stage,outcome,duration_ms) VALUES('submission','webpage','skipped',50)"
		);
		await page.goto(baseUrl + '/admin/ai-providers?tab=history&origin=submission&outcome=failed', {
			waitUntil: 'networkidle'
		});
		assert.equal(await page.locator('.admin-table tbody tr').count(), 20);
		await page.getByRole('link', { name: '下一页', exact: true }).click();
		await page.waitForURL((url) => url.searchParams.get('page') === '2');
		await page.waitForFunction(
			() => document.querySelectorAll('.admin-table tbody tr').length === 3
		);
		assert.equal(await page.locator('.admin-table tbody tr').count(), 3);
		assert.ok(page.url().includes('origin=submission') && page.url().includes('outcome=failed'));
		for (const theme of ['light', 'dark'])
			for (const width of [320, 375, 1366, 1920]) {
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate((value) => {
					document.documentElement.dataset.theme = value;
					localStorage.setItem('navinest-theme', value);
				}, theme);
				for (const [name, path] of [
					['editor', `?edit=${id}`],
					['history', '?tab=history']
				]) {
					await page.goto(baseUrl + '/admin/ai-providers' + path, { waitUntil: 'networkidle' });
					await page.evaluate((value) => {
						document.documentElement.dataset.theme = value;
					}, theme);
					if (name === 'editor') await page.getByText('高级参数', { exact: true }).click();
					await page.evaluate(() => {
						document.activeElement?.blur();
						window.scrollTo(0, 0);
					});
					await page.waitForTimeout(250);
					assert.ok(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
						'AI page overflows'
					);
					if (screenshots) {
						mkdirSync(screenshots, { recursive: true });
						await page.screenshot({
							path: join(screenshots, `ai-${name}-${width}-${theme}.png`),
							fullPage: true
						});
					}
					layouts++;
				}
			}
		const native = await browser.newContext({ javaScriptEnabled: false });
		await native.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
		const nativePage = await native.newPage();
		await nativePage.goto(baseUrl + `/admin/ai-providers?edit=${id}`);
		await nativePage.getByLabel('服务名称', { exact: true }).fill('原生表单保存');
		await nativePage.getByRole('button', { name: '保存配置', exact: true }).click();
		await nativePage.waitForURL((url) => url.searchParams.has('updated'));
		assert.equal(sql(`SELECT name FROM ai_providers WHERE id=${id}`)[0].name, '原生表单保存');
		await nativePage.getByRole('button', { name: '测试已保存配置', exact: true }).click();
		await nativePage.getByRole('alert').filter({ hasText: '解密失败' }).waitFor();
		await native.close();
		assert.deepEqual(errors, []);
	} catch (error) {
		if (screenshots) {
			mkdirSync(screenshots, { recursive: true });
			await page.screenshot({ path: join(screenshots, 'ai-workflow-failure.png'), fullPage: true });
		}
		throw error;
	} finally {
		await admin.close();
		await user.close();
		await anon.close();
		sql('DELETE FROM ai_service_calls;DELETE FROM ai_providers;');
	}
	return layouts;
}
