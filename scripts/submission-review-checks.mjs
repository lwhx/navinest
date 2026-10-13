import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The caller owns the temporary LOCAL worker and D1 state; this cannot target production.
export async function checkSubmissionReview({ page, baseUrl, command, screenshots, userToken }) {
	const context = page.context(),
		browser = context.browser();
	const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
	const execute = (sql) =>
		JSON.parse(
			command(['d1', 'execute', 'navinest-admin-check', '--local', '--command', sql, '--json'])
		);
	const rows = (sql) => execute(sql)[0].results;
	const endpoint = (id) => `${baseUrl}/api/admin/submissions/${id}/review`;
	const queueUrl = (id, changes = {}) =>
		baseUrl +
		'/admin/submissions?' +
		new URLSearchParams({
			status: 'pending',
			q: '审核回归',
			...(id ? { submission: String(id) } : {}),
			...changes
		});
	const field = (name, tab = page) => tab.locator(`.review-form [name="${name}"]`);
	const approve = (tab = page) => tab.getByRole('button', { name: '审核通过并发布', exact: true });
	const cancel = () => page.getByRole('button', { name: '撤销未开始的审核', exact: true });
	const open = async (id, changes = {}) => {
		const response = await page.goto(queueUrl(id, changes), { waitUntil: 'networkidle' });
		assert.equal(response.status(), 200);
		await page.locator('.review-detail-head').waitFor();
	};
	const ready = async () =>
		page.waitForFunction(() => {
			const button = document.querySelector('.review-form button[value="approve"]');
			return button && !button.disabled && !button.closest('fieldset')?.disabled;
		});
	const settled = async () => page.locator('.review-recovery').waitFor({ state: 'hidden' });
	const assertSingle = (id, slug) => {
		assert.equal(rows(`SELECT COUNT(*) n FROM items WHERE slug=${quote(slug)}`)[0].n, 1);
		assert.equal(
			rows(
				`SELECT COUNT(*) n FROM messages WHERE type='submission_review' AND json_extract(data_json,'$.submissionId')=${id}`
			)[0].n,
			1
		);
	};
	const payload = JSON.stringify({
		summary: '审核前的中文简介',
		content: '审核前的补充说明',
		url: 'https://example.com/review',
		userCategoryId: 1,
		tagNames: ['审核回归标签']
	});
	const values = Array.from(
		{ length: 221 },
		(_, i) =>
			`(${2000 + i},2,'site',${quote('审核回归资源 ' + (i + 1))},${quote(payload)},'pending','2026-10-14 00:00:00')`
	);
	execute(
		`INSERT INTO submissions(id,user_id,type,title,payload_json,status,created_at) VALUES ${values.join(',')}; INSERT INTO items(id,type,title,slug,status,visibility) VALUES(9000,'site','审核回归已有内容','review-existing','published','public');`
	);

	// Read and write endpoints require the real administrator session.
	for (const authenticated of [false, true]) {
		const outsider = await browser.newContext();
		try {
			if (authenticated)
				await outsider.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
			const expected = authenticated ? 403 : 401;
			assert.equal(
				(await outsider.request.get(baseUrl + '/api/admin/submissions')).status(),
				expected
			);
			assert.equal((await outsider.request.get(endpoint(2220))).status(), expected);
			assert.equal(
				(
					await outsider.request.patch(endpoint(2220), {
						data: {
							decision: 'cancel-unstarted',
							requestKey: 'anonymous-request-123',
							previousKey: ''
						}
					})
				).status(),
				expected
			);
		} finally {
			await outsider.close();
		}
	}
	await page.setViewportSize({ width: 1366, height: 900 });
	await open(2220);
	assert.equal(await page.locator('.review-list > a').count(), 20);
	assert.equal((await page.locator('.review-queue-head').innerText()).includes('221 条'), true);
	assert.match(await page.locator('.review-pagination').innerText(), /第 1 \/ 12 页/);
	assert.match(await page.locator('.review-detail').innerText(), /所选投稿在第 12 页/);
	await page.getByRole('link', { name: '定位到所在页', exact: true }).click();
	await page.waitForURL((url) => url.searchParams.get('page') === '12');
	assert.equal(await page.locator('.review-list > a').count(), 1);
	assert.equal(await page.locator('.review-list > a[aria-current="true"]').count(), 1);
	const shared = page.url();
	await page.reload({ waitUntil: 'networkidle' });
	assert.equal(page.url(), shared);
	assert.match(await page.locator('.review-detail-head').innerText(), /Submission #2220/i);
	await page.getByRole('link', { name: '上一页', exact: true }).click();
	await page.waitForURL((url) => url.searchParams.get('page') === '11');
	assert.equal(new URL(page.url()).searchParams.has('submission'), false);
	await page.goBack({ waitUntil: 'networkidle' });
	assert.equal(page.url(), shared);
	await page.getByRole('button', { name: '筛选', exact: true }).click();
	await page.waitForURL(
		(url) => !url.searchParams.has('page') && !url.searchParams.has('submission')
	);
	assert.match(await page.locator('.review-pagination').innerText(), /第 1 \/ 12 页/);

	// A failed validation preserves edits and focuses the precise field before a safe retry.
	await open(2220, { page: '12' });
	await field('title').fill('审核回归编辑后的标题');
	await field('summary').fill('审核回归保留的编辑简介');
	await field('slug').fill('review-existing');
	await approve().click();
	await page.locator('#review-error-slug').waitFor();
	await ready();
	assert.equal(await field('title').inputValue(), '审核回归编辑后的标题');
	assert.equal(await field('summary').inputValue(), '审核回归保留的编辑简介');
	assert.equal(await field('slug').getAttribute('aria-invalid'), 'true');
	assert.equal(await field('slug').evaluate((node) => node === document.activeElement), true);
	await field('categoryId').evaluate((select) => select.add(new Option('错误类型分类', '2')));
	await field('categoryId').selectOption('2');
	await field('slug').fill('review-success-1');
	await approve().click();
	await page.locator('#review-error-categoryId').waitFor();
	await ready();
	assert.equal(await field('title').inputValue(), '审核回归编辑后的标题');
	await field('categoryId').selectOption('1');
	await page.locator('.review-form input[name="newTagNames"]').check();
	await approve().click();
	await settled();
	await page.locator('.review-result').getByRole('link', { name: '查看已发布内容' }).waitFor();
	await page.waitForURL((url) => url.searchParams.get('submission') !== '2220');
	assert.match(await page.locator('.review-pagination').innerText(), /第 11 \/ 11 页/);
	assert.equal((await page.locator('.review-queue-head').innerText()).includes('220 条'), true);
	assertSingle(2220, 'review-success-1');
	assert.equal(rows("SELECT COUNT(*) n FROM tags WHERE name='审核回归标签'")[0].n, 1);
	await open(2220, { status: 'published' });
	assert.equal(await page.locator('.review-list > a').count(), 1);
	assert.equal(await page.locator('.review-form').count(), 0);
	await page.locator('.review-detail').getByRole('link', { name: '查看已发布内容' }).click();
	await page.waitForURL('**/sites/review-success-1');
	assert.equal(await page.locator('.product-detail-hero h1').textContent(), '审核回归编辑后的标题');

	// Commit the actual mutation but lose its HTTP acknowledgement: reconcile, never duplicate.
	let acknowledgedBody;
	await page.route(endpoint(2219), async (route) => {
		if (route.request().method() !== 'PATCH') return route.continue();
		acknowledgedBody = route.request().postDataJSON();
		const response = await route.fetch();
		assert.equal(response.status(), 200);
		await route.abort('failed');
	});
	await open(2219);
	await field('slug').fill('review-lost-ack');
	await approve().click();
	await settled();
	await page.locator('.review-result').getByRole('link', { name: '查看已发布内容' }).waitFor();
	await page.unroute(endpoint(2219));
	assert.equal(
		(await context.request.patch(endpoint(2219), { data: acknowledgedBody })).status(),
		409
	);
	assertSingle(2219, 'review-lost-ack');

	// A request that never reached D1 stays locked until a conditional withdrawal wins.
	let delayedBody;
	await page.route(endpoint(2218), async (route) => {
		if (
			route.request().method() === 'PATCH' &&
			route.request().postDataJSON().decision === 'approve'
		) {
			delayedBody = route.request().postDataJSON();
			return route.abort('failed');
		}
		await route.continue();
	});
	await open(2218);
	await field('title').fill('审核回归撤销后保留的标题');
	await field('slug').fill('review-never-started');
	await approve().click();
	await cancel().waitFor();
	assert.equal(await approve().isDisabled(), true);
	await cancel().click();
	await settled();
	await ready();
	assert.equal(await field('title').inputValue(), '审核回归撤销后保留的标题');
	await page.unroute(endpoint(2218));
	assert.equal((await context.request.patch(endpoint(2218), { data: delayedBody })).status(), 409);
	assert.equal(rows("SELECT COUNT(*) n FROM items WHERE slug='review-never-started'")[0].n, 0);
	// A queue read failure retains the same draft and prevents editing until a fresh read succeeds.
	const queueEndpoint = baseUrl + '/api/admin/submissions' + new URL(page.url()).search;
	await page.route(queueEndpoint, (route) =>
		route.fulfill({
			status: 503,
			contentType: 'application/json',
			body: JSON.stringify({ error: 'local queue read failed' })
		})
	);
	await page.getByRole('link', { name: '刷新队列', exact: true }).click();
	await page.getByRole('alert').filter({ hasText: '队列刷新失败' }).waitFor();
	assert.equal(await field('title').inputValue(), '审核回归撤销后保留的标题');
	assert.equal(await approve().isDisabled(), true);
	await page.unroute(queueEndpoint);
	await page.getByRole('link', { name: '刷新队列', exact: true }).click();
	await ready();
	assert.equal(await field('title').inputValue(), '审核回归撤销后保留的标题');

	// Failed/malformed status reads cannot release the lock. Reload restores the nonce and edits.
	let reviewPosts = 0,
		readFailure = 'unavailable';
	await page.route(endpoint(2217), async (route) => {
		if (
			route.request().method() === 'PATCH' &&
			route.request().postDataJSON().decision === 'approve'
		) {
			reviewPosts++;
			return route.abort('failed');
		}
		if (route.request().method() === 'GET' && readFailure) {
			return route.fulfill({
				status: readFailure === 'malformed' ? 200 : 503,
				contentType: 'application/json',
				body: JSON.stringify(
					readFailure === 'malformed'
						? { data: { id: 2217, status: 'pending' } }
						: { error: 'local read failed' }
				)
			});
		}
		await route.continue();
	});
	await open(2217);
	await field('title').fill('审核回归刷新后保留的标题');
	await field('slug').fill('review-refresh-recovery');
	await approve().click();
	await page.getByRole('status').filter({ hasText: '暂时无法核对审核状态' }).waitFor();
	assert.equal(await approve().isDisabled(), true);
	await page.reload({ waitUntil: 'networkidle' });
	await page.getByRole('status').filter({ hasText: '暂时无法核对审核状态' }).waitFor();
	assert.equal(await field('title').inputValue(), '审核回归刷新后保留的标题');
	assert.equal(await approve().isDisabled(), true);
	readFailure = 'malformed';
	await page.getByRole('button', { name: '核对状态', exact: true }).click();
	await page.getByRole('status').filter({ hasText: '审核状态响应无效' }).waitFor();
	assert.equal(await approve().isDisabled(), true);
	readFailure = '';
	await page.getByRole('button', { name: '核对状态', exact: true }).click();
	await cancel().waitFor();
	await cancel().click();
	await ready();
	await page.unroute(endpoint(2217));
	assert.equal(reviewPosts, 1);
	assert.equal(await field('title').inputValue(), '审核回归刷新后保留的标题');

	execute(
		"UPDATE submissions SET status='reviewing',review_token='held-review-secret',review_started_at=datetime('now','-30 minutes'),payload_json=json_set(payload_json,'$._review',json('{\"key\":\"held-review-request-123\",\"state\":\"running\"}')) WHERE id=2216"
	);
	await open(2216);
	assert.equal(await page.locator('.review-form').count(), 0);
	assert.equal(await cancel().count(), 0);
	assert.equal((await page.content()).includes('held-review-secret'), false);
	const busy = await context.request.get(endpoint(2216));
	assert.equal(busy.headers()['cache-control'].includes('no-store'), true);
	const busyBody = await busy.json();
	assert.equal(busyBody.data.processing, true);
	assert.equal('payload' in busyBody.data, false);
	assert.equal(JSON.stringify(busyBody).includes('held-review-secret'), false);
	assert.equal(
		(
			await context.request.patch(endpoint(2216), {
				data: {
					decision: 'cancel-unstarted',
					requestKey: 'withdraw-busy-request-123',
					previousKey: 'held-review-request-123'
				}
			})
		).status(),
		409
	);

	// Native HTML forms retain failed input and complete approval/rejection without JavaScript.
	const native = await browser.newContext({ javaScriptEnabled: false });
	try {
		await native.addCookies(await context.cookies());
		const tab = await native.newPage();
		await tab.goto(queueUrl(2215));
		await field('title', tab).fill('审核回归原生失败保留标题');
		await tab.getByRole('button', { name: '拒绝投稿', exact: true }).click();
		await tab.locator('#review-error-message').waitFor();
		assert.equal(await field('title', tab).inputValue(), '审核回归原生失败保留标题');
		await field('message', tab).fill('审核回归拒绝原因');
		await tab.getByRole('button', { name: '拒绝投稿', exact: true }).click();
		await tab.waitForURL((url) => url.searchParams.get('completed') === '2215');
		assert.match(await tab.locator('.review-result').innerText(), /已拒绝/);
		await tab.goto(queueUrl(2214));
		await field('title', tab).fill('审核回归原生发布标题');
		await field('slug', tab).fill('review-native-published');
		await approve(tab).click();
		await tab.waitForURL((url) => url.searchParams.get('completed') === '2214');
		assert.equal(
			await tab.locator('.review-result a').evaluate((link) => new URL(link.href).pathname),
			'/sites/review-native-published'
		);
		assertSingle(2214, 'review-native-published');
	} finally {
		await native.close();
	}
	const author = await browser.newContext();
	try {
		await author.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
		const tab = await author.newPage();
		assert.equal((await tab.goto(baseUrl + '/user/submissions')).status(), 200);
		const link = tab.locator('a[href$="/sites/review-native-published"]');
		await link.waitFor();
		assert.equal(await tab.getByRole('link', { name: '查看已发布内容', exact: true }).count(), 3);
		await link.click();
		await tab.waitForURL('**/sites/review-native-published');
		assert.equal(
			await tab.locator('.product-detail-hero h1').textContent(),
			'审核回归原生发布标题'
		);
	} finally {
		await author.close();
	}
	execute(
		"UPDATE submissions SET payload_json=json_set(payload_json,'$.userCategoryId',999) WHERE id=2213"
	);
	await open(2213);
	assert.equal(await field('categoryId').inputValue(), '999');
	assert.match(await field('categoryId').locator('option:checked').textContent(), /原分类已不可用/);

	// Populated selection and field errors across mobile/desktop light and dark modes.
	if (screenshots) mkdirSync(screenshots, { recursive: true });
	let layouts = 0;
	for (const width of [320, 375, 1366, 1920, 2560])
		for (const dark of [false, true]) {
			await page.setViewportSize({ width, height: 900 });
			await open(2000);
			if ((await page.getByLabel('切换深色模式').isChecked()) !== dark)
				await page.locator('.theme-toggle').click();
			await page.evaluate(() => document.fonts.ready);
			await page.getByRole('button', { name: '拒绝投稿', exact: true }).click();
			await page.locator('#review-error-message').waitFor();
			assert.equal(
				await field('message').evaluate((node) => node === document.activeElement),
				true
			);
			const sample = await page.evaluate(() => {
				const active = document.querySelector('.review-list a.active'),
					colors = getComputedStyle(active),
					badge = document.querySelector('.review-detail-head .status-badge'),
					badgeColors = getComputedStyle(badge);
				return {
					overflow: document.documentElement.scrollWidth - innerWidth,
					controls: [
						...document.querySelectorAll(
							'.review-filters input,.review-filters select,.review-filters button,.review-pagination a,.review-form button'
						)
					].map((node) => node.getBoundingClientRect().height),
					width: document.querySelector('.review-form').getBoundingClientRect().width,
					foreground: getComputedStyle(active.querySelector('strong')).color,
					background: colors.backgroundColor,
					badgeForeground: badgeColors.color,
					badgeBackground: badgeColors.backgroundColor,
					badgeHeight: badge.getBoundingClientRect().height
				};
			});
			assert.ok(sample.overflow <= 1, `${width}px review overflow: ${sample.overflow}`);
			assert.ok(
				sample.controls.every((height) => height >= 44),
				`${width}px review controls: ${sample.controls}`
			);
			assert.ok(sample.width >= 240, `${width}px editor readable width`);
			assert.ok(sample.badgeHeight < 44, `${width}px status must stay on one line`);
			const luminance = (color) => {
				const values = color
					.match(/[\d.]+/g)
					.slice(0, 3)
					.map(Number)
					.map((n) => n / 255)
					.map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
				return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
			};
			const colors = [luminance(sample.foreground), luminance(sample.background)].sort(
				(a, b) => b - a
			);
			assert.ok(
				(colors[0] + 0.05) / (colors[1] + 0.05) >= 4.5,
				`${width}px selected submission contrast`
			);
			const badgeColors = [
				luminance(sample.badgeForeground),
				luminance(sample.badgeBackground)
			].sort((a, b) => b - a);
			assert.ok(
				(badgeColors[0] + 0.05) / (badgeColors[1] + 0.05) >= 4.5,
				`${width}px status contrast`
			);
			if (screenshots) {
				await page.locator('.review-detail').scrollIntoViewIfNeeded();
				await page.screenshot({
					path: join(screenshots, `review-${width}-${dark ? 'dark' : 'light'}.png`),
					fullPage: false,
					animations: 'disabled'
				});
				await page.locator('.review-detail-head').scrollIntoViewIfNeeded();
				await page.screenshot({
					path: join(screenshots, `review-overview-${width}-${dark ? 'dark' : 'light'}.png`),
					fullPage: false,
					animations: 'disabled'
				});
			}
			layouts++;
		}
	console.log(
		`Submission review: 221-record pagination, URL selection, retained field errors, acknowledgement loss, conditional withdrawal, reload recovery, malformed reads, authorization, native forms, contributor links and ${layouts} populated CJK layouts passed.`
	);
	return layouts;
}
