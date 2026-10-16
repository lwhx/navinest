import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The caller owns the isolated LOCAL D1/R2 Worker and its test accounts.
export async function checkUserSubmissions({ browser, baseUrl, command, userToken, screenshots }) {
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
	const context = await browser.newContext();
	await context.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
	const page = await context.newPage(),
		errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const field = (name) => page.locator(`.contribute-flow [name="${name}"]`);
	const detail = () => page.getByRole('region', { name: '投稿详情', exact: true });
	const response = await context.request.post(baseUrl + '/api/user/files', {
		headers: { origin: baseUrl },
		multipart: {
			file: {
				name: 'revision-icon.png',
				mimeType: 'image/png',
				buffer: Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
					'base64'
				)
			}
		}
	});
	assert.equal(response.status(), 201);
	const iconId = (await response.json()).data.id;
	const statements = [
		"INSERT INTO categories(id,type,name,slug) VALUES(9000,'site','投稿记录分类','history-root'); INSERT INTO categories(id,type,parent_id,name,slug) VALUES(9001,'site',9000,'完整子分类','history-child')"
	];
	for (let n = 1; n <= 225; n++)
		statements.push(
			`INSERT INTO submissions(id,user_id,type,title,payload_json,status,created_at) VALUES(${8000 + n},2,'site',${quote('我的投稿验收 ' + n)},${quote(JSON.stringify({ summary: '用户自己提交的简介', content: n === 1 ? '唯一全文检索正文\n完整文章保留换行\n<script>不会执行</script>' : '原始补充说明', url: 'https://example.com/history/' + n, userCategoryId: 9001, iconFileId: n === 1 ? iconId : null, iconSource: 'manual', tagNames: ['开发', '效率'], _review: { key: 'internal-test-secret', state: 'failed' } }))},${quote(n === 1 || n === 2 ? 'rejected' : n % 3 === 0 ? 'reviewing' : 'pending')},'2026-10-16 23:00:00')`
		);
	statements.push(
		`UPDATE submissions SET review_message='请补充实际用途和适用人群。' WHERE id=8001; UPDATE submissions SET type='post',payload_json='{"content":"原文正文","summary":"原文摘要","tagNames":["经验"]}' WHERE id=8002; UPDATE submissions SET payload_json='broken',status='rejected' WHERE id=8004; UPDATE submissions SET type='book',status='rejected' WHERE id=8005; INSERT INTO submissions(id,user_id,type,title,payload_json,status) VALUES(8300,1,'site','其他作者隐私记录','{}','rejected')`
	);
	sql(statements.join(';'));
	try {
		await page.goto(baseUrl + '/user/submissions?q=我的投稿验收', { waitUntil: 'networkidle' });
		assert.match(
			await page.locator('.submission-history .account-card-header').innerText(),
			/共 225 条匹配记录.*第 1 \/ 12 页/
		);
		assert.equal(await page.locator('.history-list>li').count(), 20);
		await page.getByRole('link', { name: '下一页', exact: true }).click();
		await page.waitForURL((url) => url.searchParams.get('page') === '2');
		const second = await page.locator('.history-list h3').allTextContents();
		await page.reload({ waitUntil: 'networkidle' });
		assert.deepEqual(await page.locator('.history-list h3').allTextContents(), second);
		await page.goBack({ waitUntil: 'networkidle' });
		assert.equal(new URL(page.url()).searchParams.get('page'), null);
		await page.goto(baseUrl + '/user/submissions?q=我的投稿验收&page=9999', {
			waitUntil: 'networkidle'
		});
		assert.equal(await page.locator('.history-list>li').count(), 5);
		await page.getByRole('searchbox', { name: '搜索投稿' }).fill('唯一全文检索正文');
		await page.getByRole('button', { name: '筛选', exact: true }).click();
		await page.waitForURL((url) => url.searchParams.get('q') === '唯一全文检索正文');
		assert.equal(await page.locator('.history-list>li').count(), 1);
		assert.equal(new URL(page.url()).searchParams.get('page'), null);
		await page.getByRole('link', { name: '查看详情', exact: true }).click();
		await detail().waitFor();
		assert.match(await detail().innerText(), /完整文章保留换行/);
		assert.match(await detail().innerText(), /投稿记录分类 \/ 完整子分类/);
		assert.match(await detail().innerText(), /开发、效率/);
		assert.match(await detail().innerText(), /请补充实际用途和适用人群/);
		assert.equal(
			await detail()
				.getByRole('img', { name: '投稿图标' })
				.evaluate((el) => el.complete && el.naturalWidth > 0),
			true
		);
		assert.equal((await page.content()).includes('internal-test-secret'), false);
		const original = sql('SELECT * FROM submissions WHERE id=8001')[0];
		await detail().getByRole('link', { name: '修改后重投', exact: true }).click();
		await page.waitForURL('**/contribute?resubmit=8001');
		assert.equal(await field('title').inputValue(), '我的投稿验收 1');
		assert.match(await field('content').inputValue(), /唯一全文检索正文/);
		assert.equal(await field('categoryId').inputValue(), '9001');
		assert.equal(await field('iconFileId').inputValue(), String(iconId));
		assert.equal(await field('tagInput').inputValue(), '开发，效率');
		assert.equal(await page.locator('.contribution-types').count(), 0);
		assert.equal(await page.getByRole('button', { name: '采用全部可用建议' }).count(), 0);
		await field('title').fill('离开重投页前的临时编辑');
		await page.getByRole('link', { name: '新建其他投稿', exact: true }).click();
		await page.waitForURL(baseUrl + '/contribute');
		await page.waitForFunction(
			() => document.querySelector('.contribute-flow [name="title"]')?.value === ''
		);
		assert.equal(await field('sourceSubmissionId').inputValue(), '');
		await page.goBack({ waitUntil: 'networkidle' });
		await page.waitForURL('**/contribute?resubmit=8001');
		await page.waitForFunction(
			() => document.querySelector('.contribute-flow [name="title"]')?.value === '我的投稿验收 1'
		);
		assert.equal(await field('iconFileId').inputValue(), String(iconId));
		await field('title').fill('修改重投后的网址');
		// A category can become unavailable after the draft was loaded. Keep every edit.
		sql('UPDATE categories SET is_visible=0 WHERE id=9000');
		await page.getByRole('button', { name: '提交审核', exact: true }).click();
		await page.getByRole('alert').filter({ hasText: '分类不存在' }).first().waitFor();
		assert.equal(await field('title').inputValue(), '修改重投后的网址');
		assert.equal(await field('iconFileId').inputValue(), String(iconId));
		sql('UPDATE categories SET is_visible=1 WHERE id=9000');
		await page.getByRole('button', { name: '提交审核', exact: true }).click();
		await page.waitForURL(
			(url) => url.pathname === '/user/submissions' && url.searchParams.has('submission')
		);
		const child = Number(new URL(page.url()).searchParams.get('submission'));
		assert.equal(
			sql(
				`SELECT status,json_extract(payload_json,'$.sourceSubmissionId') parent FROM submissions WHERE id=${child}`
			)[0].parent,
			8001
		);
		assert.deepEqual(sql('SELECT * FROM submissions WHERE id=8001')[0], original);
		await detail().getByRole('link', { name: '查看原投稿 #8001' }).click();
		await page.waitForURL((url) => url.searchParams.get('submission') === '8001');
		assert.equal(await detail().getByRole('link', { name: '修改后重投' }).count(), 0);
		await detail()
			.getByRole('link', { name: '查看重投记录 #' + child })
			.click();
		await page.waitForURL((url) => url.searchParams.get('submission') === String(child));
		await page.goto(baseUrl + '/contribute?resubmit=8001', { waitUntil: 'networkidle' });
		assert.equal(await page.locator('.contribute-flow').count(), 0);
		await page.getByRole('link', { name: '查看重投记录', exact: true }).waitFor();
		for (const sourceSubmissionId of [8001, 8003, 8004, 8005, 8300]) {
			const blocked = await context.request.post(baseUrl + '/api/submissions', {
				headers: { origin: baseUrl },
				data: {
					sourceSubmissionId,
					type: 'site',
					title: '不应重复或越权重投',
					url: 'https://example.com/blocked'
				}
			});
			assert.equal(blocked.status(), 400);
		}
		assert.equal((await context.request.get(baseUrl + '/contribute?resubmit=8300')).status(), 404);
		await page.goto(baseUrl + '/user/submissions?submission=8300', { waitUntil: 'networkidle' });
		await page.getByRole('status').filter({ hasText: '不属于当前账号' }).waitFor();
		assert.equal(await detail().count(), 0);
		assert.equal((await page.content()).includes('其他作者隐私记录'), false);
		await page.goto(baseUrl + '/user/submissions?submission=8004', { waitUntil: 'networkidle' });
		assert.match(await detail().innerText(), /内容格式已损坏/);
		// Pure HTML forms must offer the same detail, filters, revision validation and append semantics.
		const native = await browser.newContext({ javaScriptEnabled: false });
		try {
			await native.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
			const tab = await native.newPage();
			await tab.goto(baseUrl + '/user/submissions?q=我的投稿验收&status=rejected');
			await tab.getByRole('searchbox', { name: '搜索投稿' }).fill('我的投稿验收 2');
			await tab.getByRole('button', { name: '筛选', exact: true }).click();
			await tab.waitForURL(
				(url) =>
					url.searchParams.get('q') === '我的投稿验收 2' &&
					url.searchParams.get('status') === 'rejected'
			);
			await tab.getByRole('link', { name: '查看详情', exact: true }).click();
			await tab
				.getByRole('region', { name: '投稿详情' })
				.getByRole('link', { name: '修改后重投' })
				.click();
			await tab.waitForURL('**/contribute?resubmit=8002');
			assert.equal(await tab.locator('[name="type"]').inputValue(), 'post');
			assert.equal(await tab.locator('[name="content"]').inputValue(), '原文正文');
			await tab.locator('[name="title"]').fill('原生重投文章');
			await tab.getByText('参考网址与智能建议（选填）', { exact: true }).click();
			await tab.locator('[name="url"]').fill('http://127.0.0.1/private');
			await tab.getByRole('button', { name: '提交审核', exact: true }).click();
			await tab.getByRole('alert').first().waitFor();
			assert.equal(await tab.locator('[name="title"]').inputValue(), '原生重投文章');
			assert.equal(await tab.locator('[name="sourceSubmissionId"]').inputValue(), '8002');
			await tab.locator('[name="url"]').fill('');
			await tab.getByRole('button', { name: '提交审核', exact: true }).click();
			await tab.waitForURL(
				(url) => url.pathname === '/user/submissions' && url.searchParams.has('submission')
			);
			const id = Number(new URL(tab.url()).searchParams.get('submission'));
			assert.equal(
				sql(
					`SELECT json_extract(payload_json,'$.sourceSubmissionId') parent FROM submissions WHERE id=${id}`
				)[0].parent,
				8002
			);
		} finally {
			await native.close();
		}
		if (screenshots) mkdirSync(screenshots, { recursive: true });
		let layouts = 0;
		// Make a fresh, unconsumed source for revision layout checks.
		sql(
			`UPDATE submissions SET status='rejected',review_message='审核意见需要保持清晰可读。' WHERE id=8006`
		);
		for (const width of [320, 375, 768, 1366, 1920])
			for (const dark of [false, true])
				for (const mode of ['history', 'revision']) {
					await page.setViewportSize({ width, height: 900 });
					await page.goto(
						baseUrl +
							(mode === 'history'
								? '/user/submissions?q=我的投稿验收&status=rejected&submission=8006#submission-detail'
								: '/contribute?resubmit=8006'),
						{ waitUntil: 'networkidle' }
					);
					if ((await page.getByLabel('切换深色模式').isChecked()) !== dark)
						await page.locator('.theme-toggle').click();
					await page.evaluate(() => document.fonts.ready);
					const sample = await page.evaluate(() => {
						const root =
							document.querySelector('.submission-detail') ??
							document.querySelector('.resubmission-note');
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
								'.submission-history p,.submission-history h3,.submission-detail p,.submission-detail dt,.submission-detail dd,.submission-detail h2,.history-status,.resubmission-note p,.resubmission-note h2,.history-actions a,.history-filters button'
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
								const l = [
									lum(getComputedStyle(el).color),
									lum(getComputedStyle(bg).backgroundColor)
								].sort((a, b) => b - a);
								return {
									text: el.textContent.trim().slice(0, 30),
									ratio: (l[0] + 0.05) / (l[1] + 0.05)
								};
							});
						return {
							overflow: document.documentElement.scrollWidth > innerWidth + 1,
							ratios,
							controls: [
								...document.querySelectorAll(
									'.submission-history input,.submission-history select,.submission-history button,.submission-history .account-button,.submission-detail .account-button,.resubmission-note .account-button'
								)
							]
								.filter((el) => el.getClientRects().length)
								.map((el) => el.getBoundingClientRect().height),
							root: root !== null
						};
					});
					assert.equal(sample.overflow, false, JSON.stringify({ width, dark, mode }));
					assert.equal(sample.root, true);
					for (const value of sample.ratios)
						assert.ok(value.ratio >= 4.5, JSON.stringify({ width, dark, mode, ...value }));
					assert.ok(sample.controls.every((h) => h >= 43.5));
					if (screenshots) {
						await (
							mode === 'history' ? detail() : page.locator('.resubmission-note')
						).scrollIntoViewIfNeeded();
						await page.screenshot({
							path: join(
								screenshots,
								`user-submissions-${mode}-${width}-${dark ? 'dark' : 'light'}.png`
							)
						});
					}
					layouts++;
				}
		assert.deepEqual(errors, []);
		console.log(
			`User submissions: complete pagination, URL filters/details, private ownership, feedback, revisions, duplicate prevention, preserved originals, native forms and ${layouts} layouts passed.`
		);
		return layouts;
	} catch (error) {
		if (screenshots) {
			mkdirSync(screenshots, { recursive: true });
			await page.screenshot({ path: join(screenshots, 'user-submissions-failure.png') });
		}
		throw error;
	} finally {
		await context.close();
	}
}
