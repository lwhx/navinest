import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// All writes and fault injection belong to the caller's isolated LOCAL Worker/D1.
export async function checkMessageWorkflow({
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
	sql(
		`INSERT INTO messages(user_id,sender_id,type,title,content,batch_id,is_read) SELECT 2,1,'system','分页消息 '||value,'正文 '||value,'message-page-'||value,value%2 FROM json_each('${JSON.stringify(Array.from({ length: 225 }, (_, n) => n))}'); INSERT INTO messages(user_id,type,title,content) VALUES(1,'system','仅管理员可见','隐私内容');`
	);
	const admin = await browser.newContext(),
		user = await browser.newContext(),
		anonymous = await browser.newContext();
	await admin.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
	await user.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
	const page = await admin.newPage(),
		inbox = await user.newPage(),
		errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	inbox.on('pageerror', (error) => errors.push(error.message));
	const api = baseUrl + '/api/admin/messages',
		headers = { origin: baseUrl },
		post = (data) => admin.request.post(api, { headers, data });
	let layouts = 0;
	try {
		assert.equal((await anonymous.request.get(api)).status(), 401);
		assert.equal((await user.request.get(api)).status(), 403);
		assert.equal(
			(
				await admin.request.post(api, { headers: { origin: 'https://other.example' }, data: {} })
			).status(),
			403
		);
		assert.equal(
			(await post({ scope: 'user', userId: 2, type: 'system', title: '未预览' })).status(),
			428
		);
		await page.goto(baseUrl + '/admin/messages?page=999', { waitUntil: 'networkidle' });
		assert.match(await page.locator('.message-history').innerText(), /226|225/);
		assert.ok(await page.getByRole('link', { name: '上一页', exact: true }).isVisible());
		const listing = await (
			await admin.request.get(api + '?q=' + encodeURIComponent('分页消息 224'))
		).json();
		assert.equal(listing.total, 1);
		await page.goto(baseUrl + '/admin/messages', { waitUntil: 'networkidle' });
		await page.getByRole('combobox', { name: '接收范围', exact: true }).selectOption('user');
		await page.getByLabel('用户编号（指定用户时填写）', { exact: true }).fill('2');
		await page.getByLabel('标题', { exact: true }).fill('实际发送验收');
		await page
			.getByLabel('正文', { exact: true })
			.fill('保留完整中文正文\n第二行 <script>plain text</script>');
		await page.route('**/api/admin/messages', (route) => route.abort());
		await page.getByRole('button', { name: '预览接收范围与内容', exact: true }).click();
		await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent);
		assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '实际发送验收');
		await page.unroute('**/api/admin/messages');
		await page.getByRole('button', { name: '预览接收范围与内容', exact: true }).click();
		await page.locator('.message-preview').waitFor();
		assert.match(await page.locator('.message-preview').innerText(), /1 人/);
		const batch = await page.locator('input[name=batchId]').inputValue();
		await page.getByLabel('我已核对接收范围、人数和消息内容', { exact: true }).check();
		// Commit server-side and discard the response. Replaying the same preview must reconcile.
		let releaseDispatch;
		const held = new Promise((resolve) => (releaseDispatch = resolve));
		await page.route('**/api/admin/messages', async (route) => {
			await route.fetch();
			await held;
			await route.abort();
		});
		await page.getByRole('button', { name: '确认发送', exact: true }).click();
		assert.equal(
			await page.getByRole('button', { name: '处理中…', exact: true }).isDisabled(),
			true
		);
		releaseDispatch();
		await page.getByRole('button', { name: '核对并重试同一批次', exact: true }).waitFor();
		assert.equal(sql(`SELECT COUNT(*) n FROM messages WHERE batch_id=${quote(batch)}`)[0].n, 1);
		await page.unroute('**/api/admin/messages');
		await page.getByRole('button', { name: '核对并重试同一批次', exact: true }).click();
		await page.getByRole('button', { name: '已完成', exact: true }).waitFor();
		assert.equal(sql(`SELECT COUNT(*) n FROM messages WHERE batch_id=${quote(batch)}`)[0].n, 1);
		await page.getByRole('link', { name: '撰写新通知', exact: true }).click();
		await page.getByLabel('标题', { exact: true }).waitFor();
		assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '');
		await inbox.goto(
			baseUrl + '/user/messages?q=' + encodeURIComponent('实际发送验收') + '&status=unread',
			{ waitUntil: 'networkidle' }
		);
		assert.match(
			await inbox.locator('.inbox-list').innerText(),
			/第二行 <script>plain text<\/script>/
		);
		await inbox.route('**/api/user/messages/*/read', (route) => route.abort());
		await inbox.getByRole('button', { name: '标为已读', exact: true }).click();
		await inbox.locator('.inbox-notice').waitFor();
		assert.equal(sql(`SELECT is_read FROM messages WHERE batch_id=${quote(batch)}`)[0].is_read, 0);
		await inbox.unroute('**/api/user/messages/*/read');
		await inbox.getByRole('button', { name: '标为已读', exact: true }).click();
		await inbox.locator('.inbox-empty').waitFor();
		assert.equal(sql(`SELECT is_read FROM messages WHERE batch_id=${quote(batch)}`)[0].is_read, 1);
		assert.ok(inbox.url().includes('status=unread'));
		const otherId = sql("SELECT id FROM messages WHERE title='仅管理员可见'")[0].id;
		assert.equal(
			(
				await user.request.patch(baseUrl + `/api/user/messages/${otherId}/read`, { headers })
			).status(),
			404
		);
		await inbox.goto(baseUrl + '/user/messages?page=999', { waitUntil: 'networkidle' });
		assert.ok(await inbox.getByRole('link', { name: '上一页', exact: true }).isVisible());
		assert.equal(await inbox.getByRole('link', { name: '下一页', exact: true }).count(), 0);
		const native = await browser.newContext({ javaScriptEnabled: false });
		await native.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
		const np = await native.newPage();
		await np.goto(baseUrl + '/admin/messages');
		await np.getByRole('combobox', { name: '接收范围', exact: true }).selectOption('user');
		await np.getByLabel('用户编号（指定用户时填写）', { exact: true }).fill('2');
		await np.getByLabel('标题', { exact: true }).fill('原生表单通知');
		await np.getByRole('button', { name: '预览接收范围与内容', exact: true }).click();
		await np.locator('.message-preview').waitFor();
		const nativeBatch = await np.locator('input[name=batchId]').inputValue();
		await np.getByLabel('我已核对接收范围、人数和消息内容', { exact: true }).check();
		await np.getByRole('button', { name: '确认发送', exact: true }).click();
		await np.locator('.message-detail').waitFor();
		assert.equal(
			sql(`SELECT COUNT(*) n FROM messages WHERE batch_id=${quote(nativeBatch)}`)[0].n,
			1
		);
		await np
			.getByLabel('确认撤回此批次；所有接收用户都将无法继续查看，已读数量保留供核对', {
				exact: true
			})
			.check();
		await np.getByRole('button', { name: '撤回此批次', exact: true }).click();
		assert.match(await np.locator('.message-detail').innerText(), /已撤回/);
		await inbox.goto(baseUrl + '/user/messages?q=' + encodeURIComponent('原生表单通知'), {
			waitUntil: 'networkidle'
		});
		await inbox.locator('.inbox-empty').waitFor();
		await native.close();
		const nativeUser = await browser.newContext({ javaScriptEnabled: false });
		await nativeUser.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
		const nativeInbox = await nativeUser.newPage();
		await nativeInbox.goto(
			baseUrl + '/user/messages?status=unread&q=' + encodeURIComponent('分页消息 224')
		);
		await nativeInbox.getByRole('button', { name: '标为已读', exact: true }).click();
		await nativeInbox.locator('.inbox-empty').waitFor();
		await nativeUser.close();
		// Test stale audience before execution, with no delivery rows created.
		const draft = {
				scope: 'user',
				userId: 2,
				type: 'system',
				title: '过期范围',
				content: '不应发送'
			},
			proof = (await (await post({ ...draft, action: 'preview' })).json()).preview;
		sql("UPDATE users SET display_name='变更后的测试用户' WHERE id=2");
		assert.equal((await post({ ...draft, proof, confirmed: true })).status(), 409);
		assert.equal(
			sql(`SELECT COUNT(*) n FROM messages WHERE batch_id=${quote(proof.batchId)}`)[0].n,
			0
		);
		for (const theme of ['light', 'dark'])
			for (const width of [320, 375, 768, 1366, 1920]) {
				for (const [target, path, name] of [
					[page, '/admin/messages', 'admin'],
					[inbox, '/user/messages', 'inbox'],
					[page, '/admin/messages', 'preview']
				]) {
					await target.setViewportSize({ width, height: 1000 });
					await target.goto(baseUrl + path, { waitUntil: 'networkidle' });
					if ((await target.getByLabel('切换深色模式').isChecked()) !== (theme === 'dark'))
						await target.locator('.theme-toggle').click();
					await target.evaluate(() => document.fonts.ready);
					if (name === 'preview') {
						await target
							.getByRole('combobox', { name: '接收范围', exact: true })
							.selectOption('user');
						await target.getByLabel('用户编号（指定用户时填写）', { exact: true }).fill('2');
						await target
							.getByLabel('标题', { exact: true })
							.fill('预览中文消息标题，核对发送范围与人数');
						await target
							.getByLabel('正文', { exact: true })
							.fill('保留正文换行\n用户可在站内消息查看通知。');
						await target.getByRole('button', { name: '预览接收范围与内容', exact: true }).click();
						await target.locator('.message-preview').waitFor();
					}
					const ratio = await target
						.locator(name === 'inbox' ? '.inbox-meta' : '.message-meta')
						.first()
						.evaluate((node) => {
							const rgb = (c) =>
								c
									.match(/[\d.]+/g)
									.slice(0, 3)
									.map(Number)
									.map((v) => v / 255)
									.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
							const lum = (c) => {
								const a = rgb(c);
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
					assert.ok(ratio >= 4.5, `${name} ${theme} contrast ${ratio}`);

					assert.ok(
						await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
						`${name} ${width} overflow`
					);
					const dimensions = await target
						.locator(
							name !== 'inbox'
								? '.message-history button,.message-history a,.message-compose button'
								: '.inbox button,.inbox a'
						)
						.evaluateAll((nodes) =>
							nodes
								.filter((n) => n.getBoundingClientRect().width > 0)
								.map((n) => ({ text: n.textContent, h: n.getBoundingClientRect().height }))
						);
					assert.ok(
						dimensions.every((n) => n.h >= 43.5),
						JSON.stringify(dimensions)
					);
					if (screenshots) {
						mkdirSync(screenshots, { recursive: true });
						await target.screenshot({
							path: join(screenshots, `messages-${name}-${width}-${theme}.png`),
							fullPage: true
						});
						if (width === 320 || width === 1366)
							await target.screenshot({
								path: join(screenshots, `messages-${name}-${width}-${theme}-viewport.png`)
							});
					}
					layouts++;
				}
			}
		// Some long-lived installations predate the optional batch_id column.
		sql(
			"UPDATE messages SET data_json=json_set(CASE WHEN json_valid(data_json) THEN data_json ELSE '{}' END,'$.dispatchBatchId',batch_id) WHERE batch_id IS NOT NULL; DROP INDEX IF EXISTS idx_messages_batch; ALTER TABLE messages DROP COLUMN batch_id;"
		);
		try {
			const legacyDraft = {
					scope: 'user',
					userId: 2,
					type: 'system',
					title: '旧表兼容验收',
					content: '仅本地夹具'
				},
				legacyProof = (await (await post({ ...legacyDraft, action: 'preview' })).json()).preview;
			assert.equal((await admin.request.get(api)).status(), 200);
			const delivered = await post({ ...legacyDraft, proof: legacyProof, confirmed: true });
			assert.equal(delivered.status(), 201);
			assert.equal((await delivered.json()).recipients, 1);
			assert.equal(
				(await (await post({ ...legacyDraft, proof: legacyProof, confirmed: true })).json())
					.repeated,
				true
			);
			assert.equal(
				(
					await admin.request.delete(api + '/' + legacyProof.batchId, {
						headers: { ...headers, 'x-message-confirmed': 'yes' }
					})
				).status(),
				200
			);
			await page.goto(baseUrl + '/admin/messages?batch=' + legacyProof.batchId, {
				waitUntil: 'networkidle'
			});
			assert.match(await page.locator('.message-detail').innerText(), /已撤回/);
		} finally {
			sql(
				"ALTER TABLE messages ADD COLUMN batch_id TEXT; UPDATE messages SET batch_id=json_extract(CASE WHEN json_valid(data_json) THEN data_json ELSE '{}' END,'$.dispatchBatchId'); CREATE INDEX idx_messages_batch ON messages(batch_id);"
			);
		}

		assert.deepEqual(errors, []);
		console.log(
			'Messages: preview, actual atomic delivery, lost response replay, full pagination, native send/withdraw/read, legacy schema, ownership and 30 CJK layouts passed.'
		);
		return layouts;
	} catch (error) {
		if (screenshots) {
			mkdirSync(screenshots, { recursive: true });
			writeFileSync(join(screenshots, 'messages-failure.html'), await page.content());
			await page.screenshot({ path: join(screenshots, 'messages-failure.png'), fullPage: true });
		}
		throw error;
	} finally {
		await admin.close();
		await user.close();
		await anonymous.close();
	}
}
