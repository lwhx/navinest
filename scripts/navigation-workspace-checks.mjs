import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

// This harness owns an isolated LOCAL Worker and bindings. It cannot target production.
const temporary = mkdtempSync(join(tmpdir(), 'navinest-navigation-'));
const config = join(temporary, 'wrangler.json'),
	state = join(temporary, 'state'),
	baseUrl = 'http://127.0.0.1:5192';
const cli = resolve('node_modules/wrangler/bin/wrangler.js'),
	shots = process.env.NAVINEST_NAVIGATION_SCREENSHOT_DIR;
const userToken = randomBytes(32).toString('base64url'),
	otherToken = randomBytes(32).toString('base64url');
const hash = (value) => createHash('sha256').update(value).digest('base64url');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
writeFileSync(
	config,
	JSON.stringify({
		name: 'navinest-navigation-check',
		main: resolve('.svelte-kit/cloudflare/_worker.js'),
		compatibility_date: '2026-07-12',
		compatibility_flags: ['nodejs_als'],
		assets: { binding: 'ASSETS', directory: resolve('.svelte-kit/cloudflare') },
		vars: { ADMIN_AUTH_MODE: 'session', GITHUB_LOGIN_ENABLED: 'false', PUBLIC_SITE_URL: baseUrl },
		d1_databases: [
			{
				binding: 'DB',
				database_name: 'navinest-navigation-check',
				database_id: '00000000-0000-4000-8000-000000000001'
			}
		],
		r2_buckets: [{ binding: 'FILES', bucket_name: 'navinest-navigation-check-files' }],
		kv_namespaces: [{ binding: 'CACHE', id: '00000000000000000000000000000001' }]
	})
);
const command = (args) =>
	execFileSync(process.execPath, [cli, ...args, '--config', config, '--persist-to', state], {
		env,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
const sql = (statement) =>
	JSON.parse(command(['d1', 'execute', 'DB', '--local', '--command', statement, '--json']))[0]
		.results;
const fixture =
	readdirSync('migrations')
		.filter((n) => /^\d{4}_.*\.sql$/.test(n))
		.sort()
		.map((n) => readFileSync('migrations/' + n, 'utf8'))
		.join('\n') +
	`
INSERT INTO users(id,username,display_name,role,status)VALUES(1,'navigation-user','私人导航测试','user','active'),(2,'other-user','其他账号','user','active');
INSERT INTO user_sessions(token_hash,user_id,expires_at)VALUES(${quote(hash(userToken))},1,${quote(new Date(Date.now() + 86400000).toISOString())}),(${quote(hash(otherToken))},2,${quote(new Date(Date.now() + 86400000).toISOString())});
WITH RECURSIVE seq(n)AS(SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<24) INSERT INTO custom_categories(id,user_id,name,sort_order)SELECT 100+n,1,'分类'||printf('%02d',n),n*10 FROM seq;
INSERT INTO custom_categories(id,user_id,name)VALUES(999,2,'他人分类');
WITH RECURSIVE seq(n)AS(SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<600) INSERT INTO custom_links(id,user_id,category_id,title,url,summary,sort_order,status)SELECT 1000+n,1,100+(n%25),'资源'||printf('%03d',n),'https://example.com/resource-'||n,'中文摘要：便于查找和整理常用网站。',n*10,CASE WHEN n%3=0 THEN 'inactive' ELSE 'active' END FROM seq;
INSERT INTO custom_links(id,user_id,category_id,title,url)VALUES(9999,2,999,'他人链接','https://other.example/');`;
writeFileSync(join(temporary, 'fixture.sql'), fixture);
let server,
	browser,
	page,
	output = '';
const errors = [];
const endpoint = baseUrl + '/api/user/navigation/workspace',
	headers = { origin: baseUrl };
const app = () => page.locator('.navigation-workspace');
async function waitMessage(text) {
	await app().locator('.workspace-message').filter({ hasText: text }).waitFor();
}
async function confirmReview() {
	await app().getByRole('checkbox', { name: '我已核对所列记录和影响范围', exact: true }).check();
	await app().locator('.operation-review button.primary').click();
}
try {
	command(['d1', 'execute', 'DB', '--local', '--file', join(temporary, 'fixture.sql'), '--json']);
	server = spawn(
		process.execPath,
		[
			cli,
			'dev',
			'--local',
			'--ip',
			'127.0.0.1',
			'--port',
			'5192',
			'--inspector-port',
			'0',
			'--config',
			config,
			'--persist-to',
			state
		],
		{ env, stdio: ['ignore', 'pipe', 'pipe'] }
	);
	for (const stream of [server.stdout, server.stderr])
		stream.on('data', (chunk) => (output = (output + chunk.toString()).slice(-10000)));
	let ready = false;
	for (let i = 0; i < 100; i++) {
		try {
			const r = await fetch(baseUrl + '/login', { signal: AbortSignal.timeout(1000) });
			await r.body?.cancel();
			ready = true;
			break;
		} catch {
			await delay(200);
		}
	}
	assert.ok(ready, output);
	browser = await chromium.launch({ executablePath: process.env.NAVINEST_CHROMIUM_PATH });
	const user = await browser.newContext(),
		other = await browser.newContext(),
		anon = await browser.newContext();
	await user.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
	await other.addCookies([{ name: 'navinest_session', value: otherToken, url: baseUrl }]);
	assert.equal(
		(await anon.request.post(endpoint, { headers, data: { action: 'preview' } })).status(),
		401
	);
	assert.equal(
		(
			await user.request.post(endpoint, {
				headers: { origin: 'https://other.example' },
				data: { action: 'preview' }
			})
		).status(),
		403
	);
	page = await user.newPage();
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto(baseUrl + '/user', { waitUntil: 'networkidle' });
	assert.equal(await app().locator('.navigation-row').count(), 20);
	assert.equal(await app().locator('.editor').count(), 0);
	assert.match(await app().innerText(), /601 条链接/);
	assert.equal(await app().locator('.category-sidebar>a').count(), 12);
	// Native URL pagination and filters keep a compact DOM and preserve cross-page selections.
	await app().getByRole('button', { name: '勾选本页', exact: true }).click();
	await app().getByRole('link', { name: '链接下一页', exact: true }).click();
	await app().getByRole('checkbox', { name: '选择链接 1020 资源020', exact: true }).check();
	assert.match(await app().locator('.bulk').innerText(), /已勾选 21 条/);
	await app().getByRole('searchbox', { name: '搜索链接', exact: true }).fill('资源600');
	await app().getByRole('button', { name: '筛选链接', exact: true }).click();
	assert.equal(await app().locator('.navigation-row').count(), 1);
	assert.match(await app().locator('.bulk').innerText(), /其他筛选内 21 条/);
	assert.match(page.url(), /navQuery=/);
	await page.goBack();
	assert.equal(await app().locator('.navigation-row').count(), 20);
	await app().getByRole('combobox', { name: '批量目标分类', exact: true }).selectOption('101');
	await app().getByRole('button', { name: '移动到分类', exact: true }).click();
	assert.match(await app().locator('.operation-review').innerText(), /处理 21 条记录/);
	assert.equal(await app().locator('.operation-review li').count(), 10);
	await app().getByRole('button', { name: '核对下一页', exact: true }).click();
	await app().getByRole('button', { name: '核对下一页', exact: true }).click();
	assert.equal(await app().locator('.operation-review li').count(), 1);
	// Commit real writes and drop only the response. Reload recovers without a second write.
	let packet;
	await page.route('**/api/user/navigation/workspace', async (route) => {
		const data = route.request().postDataJSON();
		if (data?.action !== 'commit') return route.continue();
		packet = data;
		await route.fetch();
		await route.abort('failed');
	});
	await confirmReview();
	await app().getByRole('region', { name: '导航操作结果核对', exact: true }).waitFor();
	await waitMessage('尚未确认');
	assert.equal(
		await app().getByRole('button', { name: '新增链接', exact: true }).isDisabled(),
		true
	);
	await page.unroute('**/api/user/navigation/workspace');
	await page.reload({ waitUntil: 'networkidle' });
	await waitMessage('操作已完成');
	const ids = Array.from({ length: 21 }, (_, i) => 1000 + i);
	assert.equal(
		sql(`SELECT COUNT(*) n FROM custom_links WHERE id IN(${ids.join(',')}) AND category_id=101`)[0]
			.n,
		21
	);
	assert.equal(
		(await (await other.request.get(endpoint + '?runId=' + packet.runId)).json()).receipt,
		null
	);
	assert.equal(
		(await (await user.request.post(endpoint, { headers, data: packet })).json()).receipt.status,
		'completed'
	);
	// Actual status transitions retain all other fields and clear the reviewed selection.
	for (const [label, status] of [
		['批量启用', 'active'],
		['批量停用', 'inactive']
	]) {
		await app().getByRole('checkbox', { name: '选择链接 1020 资源020', exact: true }).check();
		await app().getByRole('button', { name: label, exact: true }).click();
		await confirmReview();
		await waitMessage('操作已完成');
		assert.equal(sql('SELECT status FROM custom_links WHERE id=1020')[0].status, status);
	}
	// Error responses keep the isolated editor draft and block duplicate saves while a request is pending.
	await app().getByRole('button', { name: '编辑链接 1020 资源020', exact: true }).click();
	await app().getByRole('textbox', { name: '链接标题', exact: true }).fill('保留的编辑草稿');
	await page.route('**/api/user/navigation/workspace', (route) =>
		route.fulfill({
			status: 400,
			contentType: 'application/json',
			body: JSON.stringify({ error: '字段验证失败', uncertain: false })
		})
	);
	await app().getByRole('button', { name: '保存链接', exact: true }).click();
	await waitMessage('字段验证失败');
	assert.equal(
		await app().getByRole('textbox', { name: '链接标题', exact: true }).inputValue(),
		'保留的编辑草稿'
	);
	await page.unroute('**/api/user/navigation/workspace');
	await app()
		.getByRole('link', { name: /未分类/ })
		.click();
	await page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true }).waitFor();
	await page.getByRole('button', { name: '继续编辑', exact: true }).click();
	assert.equal(
		await app().getByRole('textbox', { name: '链接标题', exact: true }).inputValue(),
		'保留的编辑草稿'
	);
	await app().getByRole('button', { name: '关闭编辑', exact: true }).click();
	await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
	assert.equal(await app().locator('.editor').count(), 0);
	// A malformed JSON error cannot falsely release an uncertain create. Cancelling blocks late delivery.
	await app().getByRole('button', { name: '添加分类', exact: true }).click();
	await app().getByRole('textbox', { name: '分类名称', exact: true }).fill('未确认分类');
	let late;
	await page.route('**/api/user/navigation/workspace', async (route) => {
		const data = route.request().postDataJSON();
		if (data?.action !== 'commit') return route.continue();
		late = data;
		await route.fulfill({
			status: 503,
			contentType: 'application/json',
			body: JSON.stringify({ error: 'temporary failure' })
		});
	});
	await app().getByRole('button', { name: '保存分类', exact: true }).click();
	await app().getByRole('region', { name: '导航操作结果核对', exact: true }).waitFor();
	assert.equal(
		await app().getByRole('button', { name: '添加分类', exact: true }).isDisabled(),
		true
	);
	await page.unroute('**/api/user/navigation/workspace');
	await page.reload({ waitUntil: 'networkidle' });
	await waitMessage('尚未查到完成记录');
	await app().getByRole('checkbox', { name: '确认取消尚未执行的操作', exact: true }).check();
	await app().getByRole('button', { name: '取消未执行的操作', exact: true }).click();
	await waitMessage('已取消');
	assert.equal(
		(await (await user.request.post(endpoint, { headers, data: late })).json()).receipt.status,
		'cancelled'
	);
	assert.equal(sql("SELECT COUNT(*) n FROM custom_categories WHERE name='未确认分类'")[0].n, 0);
	// Real save, state changes, stale baseline retention and deletion scope.
	await app().getByRole('button', { name: '新增链接', exact: true }).click();
	await app().getByRole('textbox', { name: '链接标题', exact: true }).fill('新增的私人链接');
	await app().getByRole('textbox', { name: '网址', exact: true }).fill('https://example.org/new');
	await app().getByRole('textbox', { name: '链接摘要', exact: true }).fill('新摘要');
	await app().getByRole('button', { name: '保存链接', exact: true }).click();
	await waitMessage('操作已完成');
	assert.equal(
		sql(
			"SELECT COUNT(*) n FROM custom_links WHERE user_id=1 AND title='新增的私人链接' AND summary='新摘要'"
		)[0].n,
		1
	);
	await app().getByRole('button', { name: '添加分类', exact: true }).click();
	await app().getByRole('textbox', { name: '分类名称', exact: true }).fill('并发保留草稿');
	sql("UPDATE custom_links SET summary='另一处修改' WHERE id=1300");
	await app().getByRole('button', { name: '保存分类', exact: true }).click();
	await waitMessage('导航数据已变化');
	assert.equal(
		await app().getByRole('textbox', { name: '分类名称', exact: true }).inputValue(),
		'并发保留草稿'
	);
	await app().getByRole('button', { name: '关闭编辑', exact: true }).click();
	await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
	await app().getByRole('button', { name: '刷新列表', exact: true }).click();
	await waitMessage('列表已刷新');
	await app().getByRole('link', { name: '管理分类', exact: true }).click();
	await app().getByRole('link', { name: '分类下一页', exact: true }).click();
	await app().getByRole('button', { name: '编辑分类 110 分类10', exact: true }).waitFor();
	assert.equal(await app().locator('.category-row').count(), 10);
	await app().getByRole('link', { name: '分类上一页', exact: true }).click();
	await app().getByRole('button', { name: '删除分类 100 分类00', exact: true }).click();
	assert.match(await app().locator('.operation-review').innerText(), /链接保留并移至未分类/);
	await confirmReview();
	await waitMessage('操作已完成');
	assert.equal(
		sql('SELECT COUNT(*) n FROM custom_links WHERE user_id=1 AND category_id=100')[0].n,
		0
	);
	// The 602-link collection sorts via atomic server-side neighbors, without sending a 500-ID list.
	await page.goto(baseUrl + '/user?navPage=31', { waitUntil: 'networkidle' });
	const row = app().locator('.navigation-row').filter({ hasText: '新增的私人链接' });
	await row.getByRole('button', { name: '上移链接', exact: true }).click();
	await waitMessage('操作已完成');
	assert.equal(sql('SELECT COUNT(*) n FROM custom_links WHERE user_id=2')[0].n, 1);
	// Populated Chinese light/dark layouts, including the focused editor and review at mobile width.
	let layouts = 0;
	for (const width of [320, 390, 768, 1440])
		for (const theme of ['light', 'dark']) {
			await page.goto(baseUrl + '/user?navSize=20', { waitUntil: 'networkidle' });
			await page.setViewportSize({ width, height: 1000 });
			await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
			await app().locator('#custom-navigation-title').scrollIntoViewIfNeeded();
			assert.equal(
				await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
				false,
				`overflow ${width} ${theme}`
			);
			if (process.env.NAVINEST_REQUIRE_CJK === '1')
				assert.equal(
					await page.evaluate(() => document.fonts.check('16px "Noto Sans CJK SC"')),
					true
				);
			if (shots) {
				mkdirSync(shots, { recursive: true });
				await page.screenshot({
					path: join(shots, `navigation-${width}-${theme}.png`),
					animations: 'disabled'
				});
			}
			layouts++;
			await app().getByRole('button', { name: '新增链接', exact: true }).click();
			await app()
				.getByRole('textbox', { name: '链接标题', exact: true })
				.fill('中文标题与编辑草稿 / 带有更长的文字用于检查换行');
			await app().locator('.editor').scrollIntoViewIfNeeded();
			assert.equal(
				await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
				false,
				`editor overflow ${width} ${theme}`
			);
			if (shots)
				await page.screenshot({
					path: join(shots, `editor-${width}-${theme}.png`),
					animations: 'disabled'
				});
			layouts++;
			await app().getByRole('button', { name: '关闭编辑', exact: true }).click();
			await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
		}
	const native = await browser.newContext({ javaScriptEnabled: false });
	await native.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
	const np = await native.newPage();
	await np.goto(baseUrl + '/user?navQuery=' + encodeURIComponent('资源599'));
	assert.equal(await np.locator('.navigation-row').count(), 1);
	assert.equal(await np.getByRole('button', { name: '新增链接', exact: true }).isDisabled(), true);
	await native.close();
	assert.deepEqual(errors, []);
	console.log(
		`Personal navigation: 601-link/25-category pagination, URL filters/history, cross-page selection and explicit scope, real batch move/save/category deletion, draft preservation/leave guard, stale state, response-loss recovery, cancellation/late replay, owner isolation, >500 ordering, native read-only filters and ${layouts} CJK layouts passed.`
	);
} catch (error) {
	if (page && shots) {
		mkdirSync(shots, { recursive: true });
		await page.screenshot({ path: join(shots, 'failure.png') });
		writeFileSync(join(shots, 'failure.html'), await page.content());
		writeFileSync(join(shots, 'worker.log'), output);
	}
	throw error;
} finally {
	await browser?.close();
	server?.kill('SIGTERM');
	if (server) await Promise.race([new Promise((done) => server.once('exit', done)), delay(5000)]);
	rmSync(temporary, { recursive: true, force: true });
}
