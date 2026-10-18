import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

// This harness owns an isolated LOCAL Worker and bindings. It cannot target production.
const temporary = mkdtempSync(join(tmpdir(), 'navinest-bookmark-'));
const config = join(temporary, 'wrangler.json'),
	state = join(temporary, 'state'),
	baseUrl = 'http://127.0.0.1:5191';
const cli = resolve('node_modules/wrangler/bin/wrangler.js'),
	shots = process.env.NAVINEST_BOOKMARK_SCREENSHOT_DIR;
const userToken = randomBytes(32).toString('base64url'),
	otherToken = randomBytes(32).toString('base64url');
const hash = (value) => createHash('sha256').update(value).digest('base64url');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
writeFileSync(
	config,
	JSON.stringify({
		name: 'navinest-bookmark-check',
		main: resolve('.svelte-kit/cloudflare/_worker.js'),
		compatibility_date: '2026-07-12',
		compatibility_flags: ['nodejs_als'],
		assets: { binding: 'ASSETS', directory: resolve('.svelte-kit/cloudflare') },
		vars: { ADMIN_AUTH_MODE: 'session', GITHUB_LOGIN_ENABLED: 'false', PUBLIC_SITE_URL: baseUrl },
		d1_databases: [
			{
				binding: 'DB',
				database_name: 'navinest-bookmark-check',
				database_id: '00000000-0000-4000-8000-000000000001'
			}
		],
		r2_buckets: [{ binding: 'FILES', bucket_name: 'navinest-bookmark-check-files' }],
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
INSERT INTO users(id,username,display_name,role,status)VALUES(1,'bookmark-user','书签导入测试','user','active'),(2,'other-user','其他账号','user','active');
INSERT INTO user_sessions(token_hash,user_id,expires_at)VALUES(${quote(hash(userToken))},1,${quote(new Date(Date.now() + 86400000).toISOString())}),(${quote(hash(otherToken))},2,${quote(new Date(Date.now() + 86400000).toISOString())});
INSERT INTO custom_categories(id,user_id,name,sort_order)VALUES(7000,1,'工作',30),(7001,2,'其他账号分类',0);
INSERT INTO custom_links(id,user_id,category_id,title,url,status)VALUES(7000,1,7000,'已有书签','https://example.com/already/','active');`;
writeFileSync(join(temporary, 'fixture.sql'), fixture);
let server,
	browser,
	page,
	output = '';
const errors = [];
const html =
	'<DL><H3>工作</H3><DL>' +
	Array.from(
		{ length: 225 },
		(_, i) => `<A HREF="https://example.com/import-${i}">导入资源${i}</A>`
	).join('') +
	'<A HREF="https://example.com/import-0">文件内重复</A><A HREF="https://example.com/already/">已有项</A><A HREF="javascript:alert(1)">无效项</A></DL><A HREF="https://example.org/root">无文件夹书签</A></DL>';
const endpoint = baseUrl + '/api/user/navigation/import',
	previewEndpoint = endpoint + '/preview',
	headers = { origin: baseUrl };
const count = () => Number(sql('SELECT COUNT(*) n FROM custom_links WHERE user_id=1')[0].n);
async function choose(source = html) {
	if (!(await page.locator('.import-drawer').evaluate((el) => el.open))) {
		await page.locator('.import-drawer > summary').click();
	}
	await page
		.locator('.bookmark-import input[type=file]')
		.setInputFiles({ name: 'bookmarks.html', mimeType: 'text/html', buffer: Buffer.from(source) });
	await page.getByRole('button', { name: '生成预览', exact: true }).click();
	await page.locator('.import-message').filter({ hasText: '预览完成' }).waitFor();
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
			'5191',
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
		stream.on('data', (chunk) => {
			output = (output + chunk.toString()).slice(-10000);
		});
	let ready = false;
	for (let i = 0; i < 100; i++) {
		try {
			const response = await fetch(baseUrl + '/login', { signal: AbortSignal.timeout(1000) });
			await response.body?.cancel();
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
		(await anon.request.post(previewEndpoint, { headers, data: { html } })).status(),
		401
	);
	assert.equal(
		(
			await user.request.post(previewEndpoint, {
				headers: { origin: 'https://other.example' },
				data: { html }
			})
		).status(),
		403
	);
	assert.equal((await user.request.post(endpoint, { headers, data: { html } })).status(), 428);
	page = await user.newPage();
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(baseUrl + '/user', { waitUntil: 'networkidle' });
	await choose();
	assert.equal(count(), 1, 'preview must not write any links');
	const panel = page.locator('.bookmark-import');
	assert.match(await panel.innerText(), /文件共 229 条，已选 226 条/);
	assert.equal(await panel.locator('.import-row').count(), 20);
	await panel.getByRole('button', { name: '预览下一页', exact: true }).click();
	assert.match(await panel.locator('.import-row').first().innerText(), /导入资源20/);
	await panel.getByRole('searchbox', { name: '搜索预览', exact: true }).fill('导入资源224');
	assert.equal(await panel.locator('.import-row').count(), 1);
	await panel.getByRole('searchbox', { name: '搜索预览', exact: true }).fill('');
	for (const status of ['existing', 'duplicate', 'invalid']) {
		await panel.getByRole('combobox', { name: '条目状态', exact: true }).selectOption(status);
		assert.equal(await panel.locator('.import-row').count(), 1);
		assert.equal(await panel.locator('.import-row input').isDisabled(), true);
	}
	await panel.getByRole('combobox', { name: '条目状态', exact: true }).selectOption('all');
	await panel.getByRole('checkbox', { name: '选择书签 1 导入资源0', exact: true }).uncheck();
	await panel
		.getByRole('combobox', { name: '目标分类：未分文件夹', exact: true })
		.selectOption('new');
	await panel.getByRole('textbox', { name: '新分类名称：未分文件夹', exact: true }).fill('待整理');
	assert.equal(
		await panel.getByRole('button', { name: '确认导入所选书签', exact: true }).isDisabled(),
		true
	);
	await panel.getByRole('button', { name: '更新预览', exact: true }).click();
	await panel.locator('.import-message').filter({ hasText: '已选 225 条' }).waitFor();
	assert.equal(count(), 1);
	await panel
		.getByRole('checkbox', { name: '我已核对书签和目标分类，确认导入', exact: true })
		.check();
	// Execute real D1 writes, then lose the browser response. A refresh must reconcile without resending.
	let packet;
	await page.route('**/api/user/navigation/import', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		packet = route.request().postDataJSON();
		await route.fetch();
		await route.abort('failed');
	});
	await panel.getByRole('button', { name: '确认导入所选书签', exact: true }).click();
	await panel.getByRole('region', { name: '导入结果核对', exact: true }).waitFor();
	await panel.locator('.import-message').filter({ hasText: '尚未确认' }).waitFor();
	assert.equal(count(), 226);
	assert.equal(
		await page.getByRole('button', { name: '添加分类', exact: true }).isDisabled(),
		true
	);
	await page.unroute('**/api/user/navigation/import');
	await page.reload({ waitUntil: 'networkidle' });
	await page.locator('.import-result').filter({ hasText: '本批次已完成' }).waitFor();
	assert.equal(count(), 226);
	assert.match(await page.locator('.import-result').innerText(), /新增书签 225 条/);
	assert.equal(
		(await (await other.request.get(endpoint + '?runId=' + packet.runId)).json()).receipt,
		null
	);
	assert.equal(
		(await (await user.request.post(endpoint, { headers, data: packet })).json()).receipt.imported,
		225
	);
	assert.equal(count(), 226);
	// Preview the remaining link; a blocked-before-send request can be explicitly cancelled and a late replay refused.
	await choose();
	assert.match(await page.locator('.import-message').innerText(), /已选 1 条/);
	await page
		.locator('.bookmark-import')
		.getByRole('checkbox', { name: '我已核对书签和目标分类，确认导入', exact: true })
		.check();
	let late;
	await page.route('**/api/user/navigation/import', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		late = route.request().postDataJSON();
		await route.abort('failed');
	});
	await page.getByRole('button', { name: '确认导入所选书签', exact: true }).click();
	await page.locator('.import-message').filter({ hasText: '尚未确认' }).waitFor();
	await page.unroute('**/api/user/navigation/import');
	await page.getByRole('checkbox', { name: '确认取消尚未开始的批次', exact: true }).check();
	await page.getByRole('button', { name: '取消未开始的导入', exact: true }).click();
	await page.locator('.import-result').filter({ hasText: '本批次已取消' }).waitFor();
	assert.equal(
		(await (await user.request.post(endpoint, { headers, data: late })).json()).receipt.status,
		'cancelled'
	);
	assert.equal(count(), 226);
	// Stale previews retain the chosen file and require a new review.
	await page.reload({ waitUntil: 'networkidle' });
	await choose('<DL><A HREF="https://example.com/stale">旧预览测试</A></DL>');
	sql(
		"INSERT INTO custom_links(user_id,title,url,status)VALUES(1,'并发新增','https://example.net/new','active')"
	);
	await page
		.getByRole('checkbox', { name: '我已核对书签和目标分类，确认导入', exact: true })
		.check();
	await page.getByRole('button', { name: '确认导入所选书签', exact: true }).click();
	await page.locator('.import-message').filter({ hasText: '现有导航已变化' }).waitFor();
	assert.equal(count(), 227);
	assert.equal(await panel.locator('input[type=file]').evaluate((el) => el.files.length), 1);
	// An incomplete JSON error is still unknown, even when it is a valid JSON response.
	await page.reload({ waitUntil: 'networkidle' });
	await choose('<DL><A HREF="https://example.com/unknown-json">未知响应测试</A></DL>');
	await page
		.getByRole('checkbox', { name: '我已核对书签和目标分类，确认导入', exact: true })
		.check();
	let jsonLate;
	await page.route('**/api/user/navigation/import', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		jsonLate = route.request().postDataJSON();
		await route.fulfill({
			status: 503,
			contentType: 'application/json',
			body: JSON.stringify({ error: 'temporary failure' })
		});
	});
	await page.getByRole('button', { name: '确认导入所选书签', exact: true }).click();
	await page.getByRole('region', { name: '导入结果核对', exact: true }).waitFor();
	assert.equal(await panel.locator('input[type=file]').isDisabled(), true);
	await page.unroute('**/api/user/navigation/import');
	await page.reload({ waitUntil: 'networkidle' });
	await page.locator('.import-message').filter({ hasText: '尚未查到完成记录' }).waitFor();
	await page.getByRole('checkbox', { name: '确认取消尚未开始的批次', exact: true }).check();
	await page.getByRole('button', { name: '取消未开始的导入', exact: true }).click();
	await page.locator('.import-result').filter({ hasText: '本批次已取消' }).waitFor();
	assert.equal(
		(await (await user.request.post(endpoint, { headers, data: jsonLate })).json()).receipt.status,
		'cancelled'
	);
	assert.equal(count(), 227);
	// Empty, malformed and over-limit files do not write; full 501-row preview exposes the initially unselected row.
	await page.reload({ waitUntil: 'networkidle' });
	await choose(
		'<DL>' +
			Array.from(
				{ length: 501 },
				(_, i) => `<A HREF="https://limit.example/${i}">上限资源${i}</A>`
			).join('') +
			'</DL>'
	);
	assert.match(await panel.innerText(), /已选 500 条/);
	await panel.getByRole('combobox', { name: '条目状态', exact: true }).selectOption('limited');
	assert.equal(await panel.locator('.import-row').count(), 1);
	assert.equal(await panel.locator('.import-row input').isDisabled(), true);
	await panel.getByRole('button', { name: '清空全部勾选', exact: true }).click();
	await panel.locator('.import-row input').check();
	await panel.getByRole('button', { name: '更新预览', exact: true }).click();
	await panel.locator('.import-message').filter({ hasText: '已选 1 条' }).waitFor();
	assert.equal(count(), 227);
	// Capture a populated long-text preview at desktop/mobile sizes and both themes.
	await panel.getByRole('combobox', { name: '条目状态', exact: true }).selectOption('all');
	const cjk = await page.evaluate(() => document.fonts.check('16px "Noto Sans CJK SC"'));
	if (process.env.NAVINEST_REQUIRE_CJK === '1') assert.ok(cjk, 'Chinese font must load');
	let layouts = 0;
	for (const width of [320, 390, 768, 1440])
		for (const theme of ['light', 'dark']) {
			await page.setViewportSize({ width, height: 950 });
			await page.evaluate((theme) => {
				document.documentElement.dataset.theme = theme;
			}, theme);
			await panel.scrollIntoViewIfNeeded();
			assert.equal(
				await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
				false,
				`overflow ${width} ${theme}`
			);
			const heights = await panel
				.locator('button,input:not([type=checkbox]),select,.tick')
				.evaluateAll((nodes) =>
					nodes
						.filter((n) => n.getClientRects().length)
						.map((n) => n.getBoundingClientRect().height)
				);
			assert.ok(
				heights.every((h) => h >= 43.5),
				JSON.stringify(heights)
			);
			if (shots) {
				mkdirSync(shots, { recursive: true });
				await page.screenshot({
					path: join(shots, `bookmarks-${width}-${theme}.png`),
					animations: 'disabled'
				});
			}
			layouts++;
		}
	const native = await browser.newContext({ javaScriptEnabled: false });
	await native.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
	const np = await native.newPage();
	await np.goto(baseUrl + '/user');
	assert.equal(await np.getByRole('button', { name: '生成预览', exact: true }).isDisabled(), true);
	assert.match(await np.locator('.bookmark-import').innerText(), /需要启用 JavaScript/);
	await native.close();
	assert.deepEqual(errors, []);
	console.log(
		`Bookmark imports: readonly 229-row previews, selection, classification mapping, real atomic imports, duplicate replay, lost-response refresh recovery, cancellation/late replay, stale-state rejection, 501-row limit and ${layouts} CJK layouts passed.`
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
