import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { checkHomeSubcategories } from './home-subcategory-checks.mjs';
import { checkSubmissionReview } from './submission-review-checks.mjs';
import { checkContributionFlow } from './contribution-flow-checks.mjs';
import { checkMediaLibrary } from './media-library-checks.mjs';
import { checkUserSubmissions } from './user-submission-checks.mjs';

// This check always owns a temporary LOCAL database and worker. It cannot target production.
const temporary = mkdtempSync(join(tmpdir(), 'navinest-admin-'));
const state = join(temporary, 'state');
const config = join(temporary, 'wrangler.json');
const sql = join(temporary, 'fixture.sql');
const baseUrl = 'http://127.0.0.1:5187';
const cli = resolve('node_modules/wrangler/bin/wrangler.js');
const screenshots = process.env.NAVINEST_ADMIN_SCREENSHOT_DIR;
const adminToken = randomBytes(32).toString('base64url');
const userToken = randomBytes(32).toString('base64url');
const hash = (value) => createHash('sha256').update(value).digest('base64url');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
writeFileSync(
	config,
	JSON.stringify({
		name: 'navinest-admin-check',
		main: resolve('.svelte-kit/cloudflare/_worker.js'),
		compatibility_date: '2026-07-12',
		compatibility_flags: ['nodejs_als'],
		assets: { binding: 'ASSETS', directory: resolve('.svelte-kit/cloudflare') },
		vars: { ADMIN_AUTH_MODE: 'session', GITHUB_LOGIN_ENABLED: 'false', PUBLIC_SITE_URL: baseUrl },
		d1_databases: [
			{
				binding: 'DB',
				database_name: 'navinest-admin-check',
				database_id: '00000000-0000-4000-8000-000000000001'
			}
		],
		r2_buckets: [{ binding: 'FILES', bucket_name: 'navinest-admin-check-files' }],
		kv_namespaces: [{ binding: 'CACHE', id: '00000000000000000000000000000001' }]
	})
);
const migrations = [
	'0001_initial',
	'0002_auth_sessions',
	'0003_user_activity',
	'0008_cron_health',
	'0011_ai_providers',
	'0012_hot_board_customization',
	'0013_hot_source_refresh_lease',
	'0015_submission_review_lease',
	'0016_ai_usage_reservations',
	'0017_session_metadata',
	'0018_message_batches',
	'0019_user_share_pages'
];
const statements = migrations.map((name) => readFileSync(`migrations/${name}.sql`, 'utf8'));
statements.push(
	"INSERT INTO users(id,username,display_name,role,status) VALUES(1,'layout-admin','中文管理测试账号','admin','active'),(2,'layout-user','普通测试用户','user','active');"
);
const expires = new Date(Date.now() + 86400000).toISOString();
statements.push(
	`INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES(${quote(hash(adminToken))},1,${quote(expires)}),(${quote(hash(userToken))},2,${quote(expires)});`
);
statements.push(
	"INSERT INTO categories(id,type,name,slug) VALUES(1,'site','开发工具与团队协作资源','tools'),(2,'app','软件资源','apps'),(3,'post','文章资源','articles'),(4,'book','历史书籍分类','books'),(5,'bulletin','历史公告分类','bulletins'),(9,'site','设计资源','design'); INSERT INTO categories(id,type,parent_id,name,slug) VALUES(6,'bulletin',5,'历史公告子分类','old-bulletins'),(7,'site',1,'代码托管','code-hosting'),(8,'site',1,'前端开发','frontend'),(10,'site',7,'代码平台','code-platforms'),(11,'site',9,'设计协作','design-collaboration'); INSERT INTO tags(id,type,name,slug) VALUES(1,'site','团队协作','collaboration');"
);
for (let id = 1; id <= 123; id++) {
	statements.push(
		`INSERT INTO items(id,type,category_id,title,slug,summary,status,visibility,sort_order) VALUES(${id},'site',1,${quote('中文资源与团队协作工具 ' + id)},${quote('resource-' + id)},${quote('用于整理开发资料和协作流程，便于快速找到常用资源。')},${quote(id > 100 ? 'draft' : 'published')},${quote(id % 3 ? 'public' : 'private')},${id * 10});`
	);
	statements.push(
		`INSERT INTO item_meta(item_id,meta_key,meta_value) VALUES(${id},'site_url','https://example.com/resource-${id}');`
	);
}
statements.push(
	"INSERT INTO item_tags VALUES(123,1); INSERT INTO home_modules(id,type,title,config_json,sort_order,is_enabled) VALUES(1,'search','聚合搜索','{\"recommendedSearches\":[\"开发工具\",\"团队协作\"],\"custom\":{\"keep\":true}}',10,1),(2,'content','常用开发资源','{\"categorySlug\":\"tools\",\"custom\":{\"keep\":true}}',20,1),(3,'ranking','资源排行榜','{}',100,0),(4,'links','快捷链接','{\"links\":[{\"label\":\"站内搜索\",\"url\":\"/search\"}]}',110,1); INSERT INTO submissions(user_id,type,title,payload_json,status) VALUES(2,'site','待审核资源','{}','pending'),(2,'site','已审核资源','{}','approved'); INSERT INTO hot_sources(name,type,url,slug,last_error) VALUES('热榜测试源','rss','https://example.com/feed','test-source','网络失败'); INSERT INTO cron_runs(cron,scheduled_at,status) VALUES('* * * * *','2026-10-12','partial');"
);
writeFileSync(sql, statements.join('\n'));
const command = (args) =>
	execFileSync(process.execPath, [cli, ...args, '--config', config, '--persist-to', state], {
		env,
		encoding: 'utf8',
		maxBuffer: 8 * 1024 * 1024
	});
let page,
	server,
	browser,
	output = '',
	layouts = 0;
const errors = [];
async function open(page, path) {
	const response = await page.goto(baseUrl + path, { waitUntil: 'networkidle' });
	assert.equal(response.status(), 200, `${path} failed: ${output.slice(-3000)}`);
	await page.locator('.admin-main').waitFor();
}
async function shot(page, name) {
	if (!screenshots) return;
	mkdirSync(screenshots, { recursive: true });
	await page.screenshot({
		path: join(screenshots, name + '.png'),
		fullPage: false,
		animations: 'disabled'
	});
}
function contrast(a, b) {
	const luminance = (color) => {
		const rgb = color
			.match(/[\d.]+/g)
			.slice(0, 3)
			.map(Number)
			.map((value) => value / 255)
			.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
		return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
	};
	const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (values[0] + 0.05) / (values[1] + 0.05);
}
async function checkCategoryLabels(page) {
	const labels = await page
		.locator('.category-node-copy span, .category-node-copy em')
		.evaluateAll((nodes) =>
			nodes
				.filter((node) => node.getClientRects().length)
				.map((node) => ({
					text: node.textContent,
					height: node.getBoundingClientRect().height,
					foreground: getComputedStyle(node).color,
					background: getComputedStyle(node).backgroundColor
				}))
		);
	assert.ok(labels.length > 0, 'Category labels must be present');
	for (const label of labels) {
		assert.ok(label.height <= 32, `Category label must stay on one line: ${label.text}`);
		assert.ok(
			contrast(label.foreground, label.background) >= 4.5,
			`Category label must be readable: ${label.text}`
		);
	}
}
try {
	command(['d1', 'execute', 'navinest-admin-check', '--local', '--file', sql, '--json']);
	server = spawn(
		process.execPath,
		[
			cli,
			'dev',
			'--local',
			'--ip',
			'127.0.0.1',
			'--port',
			'5187',
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
			output = (output + chunk.toString()).slice(-12000);
		});
	let ready;
	for (let i = 0; i < 100; i++) {
		try {
			ready = await fetch(baseUrl + '/login', { signal: AbortSignal.timeout(1000) });
			break;
		} catch {
			await delay(200);
		}
	}
	assert.ok(ready, `Local worker did not start: ${output}`);
	await ready.body?.cancel();
	browser = await chromium.launch({ executablePath: process.env.NAVINEST_CHROMIUM_PATH });
	const context = await browser.newContext();
	const anonymous = await context.request.get(baseUrl + '/admin', { maxRedirects: 0 });
	assert.equal(anonymous.status(), 303);
	assert.ok(anonymous.headers().location.startsWith('/login?returnTo='));
	assert.equal(
		(
			await context.request.patch(baseUrl + '/api/admin/items/bulk', {
				data: { ids: [1], action: 'draft' }
			})
		).status(),
		401
	);
	assert.equal(
		(
			await context.request.post(baseUrl + '/admin/cron-runs?/run', {
				form: { task: 'hotnews', requestKey: 'auth-task-request-123' },
				headers: { origin: baseUrl, accept: 'text/html' }
			})
		).status(),
		401
	);
	await context.addCookies([{ name: 'navinest_session', value: userToken, url: baseUrl }]);
	assert.equal((await context.request.get(baseUrl + '/admin', { maxRedirects: 0 })).status(), 403);
	assert.equal(
		(
			await context.request.patch(baseUrl + '/api/admin/items/bulk', {
				data: { ids: [1], action: 'draft' }
			})
		).status(),
		403
	);
	assert.equal(
		(
			await context.request.post(baseUrl + '/admin/cron-runs?/run', {
				form: { task: 'hotnews', requestKey: 'auth-task-request-123' },
				headers: { origin: baseUrl, accept: 'text/html' }
			})
		).status(),
		403
	);
	await context.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
	assert.equal(
		(
			await context.request.post(baseUrl + '/admin/cron-runs?/run', {
				form: { task: 'hotnews', requestKey: 'cross-origin-request-123' },
				headers: { origin: 'https://untrusted.example', accept: 'text/html' }
			})
		).status(),
		403
	);
	page = await context.newPage();
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('dialog', (dialog) => dialog.accept());
	// Reuse isolated local D1 fixtures; restore their original state before administration checks.
	command([
		'd1',
		'execute',
		'DB',
		'--local',
		'--command',
		"UPDATE items SET category_id=CASE id WHEN 1 THEN 7 WHEN 2 THEN 10 WHEN 3 THEN 7 WHEN 4 THEN 8 WHEN 5 THEN 11 END WHERE id IN(1,2,3,4,5); INSERT INTO categories(id,type,parent_id,name,slug) VALUES(12,'site',1,'空分类','empty'); INSERT INTO home_modules(id,type,title,config_json,sort_order,is_enabled) VALUES(5,'content','设计资源','{\"categorySlug\":\"design\"}',30,1);"
	]);
	try {
		await checkHomeSubcategories(page, baseUrl, screenshots);
	} finally {
		command([
			'd1',
			'execute',
			'DB',
			'--local',
			'--command',
			'UPDATE items SET category_id=1 WHERE id IN(1,2,3,4,5); DELETE FROM home_modules WHERE id=5; DELETE FROM categories WHERE id=12;'
		]);
	}

	// The actual local D1-backed Worker must filter before counting and paging public results.
	await page.goto(
		baseUrl + '/search?q=' + encodeURIComponent('中文资源') + '&category=site%3Atools&page=2',
		{ waitUntil: 'networkidle' }
	);
	assert.equal(await page.locator('.results-cards .benchmark-card').count(), 24);
	assert.ok((await page.locator('.search-listing-hero strong').textContent()).includes('67'));
	assert.equal(
		await page.getByRole('combobox', { name: '分类范围', exact: true }).inputValue(),
		'site:tools'
	);
	assert.equal(await page.locator('.results-cards h3 mark').first().textContent(), '中文资源');
	await page.getByRole('link', { name: '下一页', exact: true }).click();
	await page.waitForURL(
		(url) =>
			url.searchParams.get('page') === '3' && url.searchParams.get('category') === 'site:tools'
	);
	assert.equal(await page.locator('.results-cards .benchmark-card').count(), 19);
	await page.goBack({ waitUntil: 'networkidle' });
	assert.equal(new URL(page.url()).searchParams.get('category'), 'site:tools');
	await page.waitForFunction(() =>
		document.querySelector('.search-pagination p')?.textContent?.includes('第 2 / 3 页')
	);
	assert.equal(await page.locator('.results-cards .benchmark-card').count(), 24);
	await open(page, '/admin/categories');
	assert.deepEqual(
		await page
			.locator('.category-type-filter option')
			.evaluateAll((options) => options.map((option) => option.value)),
		['all', 'site', 'post']
	);
	assert.equal(await page.locator('.category-browser .category-tree-node').count(), 7);
	assert.equal(await page.locator('.category-legacy').getAttribute('open'), null);
	await page.locator('.category-legacy summary').click();
	assert.equal(await page.locator('.category-legacy .category-tree-node').count(), 4);
	assert.equal(await page.locator('.category-legacy a[href*="create="]').count(), 0);
	await open(page, '/admin/categories?create=1&parent=1');
	assert.deepEqual(
		await page
			.locator('select[name="type"] option')
			.evaluateAll((options) => options.map((option) => option.value)),
		['site', 'post']
	);
	assert.equal(await page.getByLabel('一级分类', { exact: true }).inputValue(), '1');
	assert.equal(await page.locator('input[name="parentId"]').inputValue(), '1');
	assert.deepEqual(
		await page
			.getByLabel('一级分类', { exact: true })
			.locator('option')
			.evaluateAll((options) => options.map((option) => option.value)),
		['', '1', '9']
	);
	assert.deepEqual(
		await page
			.getByLabel('二级分类', { exact: true })
			.locator('option')
			.evaluateAll((options) => options.map((option) => option.value)),
		['', '7', '8']
	);
	await page.getByLabel('类型', { exact: true }).selectOption('post');
	assert.equal(await page.locator('input[name="parentId"]').inputValue(), '');
	assert.equal(await page.getByLabel('二级分类', { exact: true }).count(), 0);
	assert.deepEqual(
		await page
			.getByLabel('一级分类', { exact: true })
			.locator('option')
			.evaluateAll((options) => options.map((option) => option.value)),
		['', '3']
	);
	await page.getByLabel('一级分类', { exact: true }).selectOption('3');
	await page.getByLabel('名称', { exact: true }).fill('新的文章子分类');
	await page.getByLabel('Slug', { exact: true }).fill('new-articles');
	await page.getByRole('button', { name: '保存分类', exact: true }).click();
	await page.waitForURL('**created=1');
	await page.getByText('新的文章子分类', { exact: true }).waitFor();
	await open(page, '/admin/categories?create=1&parent=7');
	assert.equal(await page.getByLabel('一级分类', { exact: true }).inputValue(), '1');
	assert.equal(await page.getByLabel('二级分类', { exact: true }).inputValue(), '7');
	assert.equal(await page.locator('input[name="parentId"]').inputValue(), '7');
	assert.ok(
		(await page.locator('.parent-selection-path').textContent()).includes('保存后为第 3 级分类')
	);
	await page.getByLabel('一级分类', { exact: true }).selectOption('9');
	assert.equal(await page.getByLabel('二级分类', { exact: true }).inputValue(), '');
	assert.deepEqual(
		await page
			.getByLabel('二级分类', { exact: true })
			.locator('option')
			.evaluateAll((options) => options.map((option) => option.value)),
		['', '11']
	);
	assert.equal(await page.getByLabel('三级分类', { exact: true }).count(), 0);
	assert.equal(await page.locator('input[name="parentId"]').inputValue(), '9');
	await page.getByLabel('一级分类', { exact: true }).selectOption('');
	assert.equal(await page.locator('input[name="parentId"]').inputValue(), '');
	assert.equal(await page.getByLabel('二级分类', { exact: true }).count(), 0);
	await page.getByLabel('一级分类', { exact: true }).selectOption('1');
	await page.getByLabel('一级分类', { exact: true }).focus();
	await page.keyboard.press('Tab');
	assert.equal(
		await page
			.getByLabel('二级分类', { exact: true })
			.evaluate((node) => node === document.activeElement),
		true
	);
	await open(page, '/admin/categories?edit=7');
	const offered = await page
		.locator('.parent-selection-levels option')
		.evaluateAll((options) => options.map((option) => option.value));
	assert.ok(
		!offered.includes('7') && !offered.includes('10'),
		'Editing parent cannot select itself or descendants'
	);
	await page.getByLabel('一级分类', { exact: true }).selectOption('9');
	await page.getByRole('button', { name: '保存分类', exact: true }).click();
	await page.waitForURL('**updated=1');
	await open(page, '/admin/categories?edit=10');
	assert.equal(await page.getByLabel('一级分类', { exact: true }).inputValue(), '9');
	assert.equal(await page.getByLabel('二级分类', { exact: true }).inputValue(), '7');
	assert.equal(await page.locator('input[name="parentId"]').inputValue(), '7');
	assert.ok(
		(await page.locator('.parent-selection-path').textContent()).includes('设计资源 / 代码托管')
	);
	assert.equal(
		(
			await context.request.patch(baseUrl + '/api/admin/categories/7', {
				data: { type: 'site', parentId: 10, name: '代码托管', slug: 'code-hosting' }
			})
		).status(),
		400
	);
	const noScript = await browser.newContext({ javaScriptEnabled: false });
	await noScript.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
	const nativePage = await noScript.newPage();
	await nativePage.goto(baseUrl + '/admin/categories?edit=10', { waitUntil: 'networkidle' });
	assert.equal(
		await nativePage.getByLabel('父级分类（完整路径）', { exact: true }).inputValue(),
		'7'
	);
	await nativePage.getByLabel('名称', { exact: true }).fill('代码平台原生保存验证');
	await nativePage.getByRole('button', { name: '保存分类', exact: true }).click();
	await nativePage.waitForURL('**updated=1');
	await noScript.close();
	await open(page, '/admin/categories?edit=10');
	assert.equal(await page.getByLabel('名称', { exact: true }).inputValue(), '代码平台原生保存验证');
	assert.equal(await page.locator('input[name="parentId"]').inputValue(), '7');
	for (const type of ['app', 'book', 'bulletin']) {
		assert.equal(
			(
				await context.request.post(baseUrl + '/api/admin/categories', {
					data: { type, name: '拒绝旧类型', slug: 'blocked-' + type }
				})
			).status(),
			400
		);
		assert.equal(
			(
				await context.request.patch(baseUrl + '/api/admin/categories/3', {
					data: { type, name: '拒绝改类型', slug: 'blocked-' + type }
				})
			).status(),
			400
		);
		assert.equal(
			(
				await context.request.post(baseUrl + '/admin/categories?create=1&/create', {
					headers: { Origin: baseUrl, Accept: 'text/html' },
					form: { type, name: '拒绝旧类型', slug: 'blocked-' + type },
					maxRedirects: 0
				})
			).status(),
			400
		);
	}
	assert.equal(
		(await context.request.get(baseUrl + '/admin/categories?create=1&parent=2')).status(),
		400
	);
	await open(page, '/admin/categories?edit=2');
	assert.equal(await page.locator('select[name="type"]').count(), 0);
	assert.equal(await page.locator('input[name="type"]').inputValue(), 'app');
	await page.getByLabel('名称', { exact: true }).fill('整理后的历史软件分类');
	await page.getByLabel('前台可见', { exact: true }).uncheck();
	await page.getByRole('button', { name: '保存分类', exact: true }).click();
	await page.waitForURL('**updated=1');
	await page.locator('.category-legacy summary').click();
	await page
		.locator('.category-legacy .category-node-copy strong')
		.filter({ hasText: '整理后的历史软件分类' })
		.waitFor();
	assert.ok((await page.locator('.category-legacy').textContent()).includes('已隐藏'));
	await open(page, '/admin/items?page=3');
	assert.equal(await page.locator('.content-row').count(), 23);
	assert.ok((await page.locator('.content-overview').textContent()).includes('123'));
	await page.getByRole('link', { name: '上一页', exact: true }).click();
	await page.waitForURL('**page=2');
	assert.equal(await page.locator('.content-row').count(), 50);
	await page.getByRole('searchbox', { name: '搜索内容' }).fill('resource-123');
	await page.getByRole('button', { name: '筛选', exact: true }).click();
	await page.waitForURL('**q=resource-123*');
	assert.equal(await page.locator('.content-row').count(), 1);
	await page.reload({ waitUntil: 'networkidle' });
	assert.equal(
		await page.getByRole('searchbox', { name: '搜索内容' }).inputValue(),
		'resource-123'
	);
	await page.locator('.content-row .content-edit-button').click();
	await page.getByRole('dialog').waitFor();
	assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
	assert.equal(await page.locator('.admin-sidebar').evaluate((node) => node.inert), true);
	await page.getByLabel('标题', { exact: true }).fill('编辑后立即显示的中文资源');
	await page.getByLabel('摘要', { exact: true }).fill('编辑后的用途说明。');
	await page.getByRole('button', { name: '保存内容', exact: true }).click();
	await page.getByRole('dialog').waitFor({ state: 'hidden' });
	await page.getByText('编辑后立即显示的中文资源', { exact: true }).waitFor();
	assert.equal(await page.locator('.content-row').count(), 1);
	assert.equal(new URL(page.url()).searchParams.get('q'), 'resource-123');
	assert.equal(await page.evaluate(() => document.body.style.overflow), '');
	await page.locator('.content-row-select input').check();
	await page.getByRole('combobox', { name: '批量操作' }).selectOption('publish');
	// Hold the real reload so a success notice cannot race ahead of the rendered rows.
	const refreshRoute = '**/admin/items/__data.json*';
	let releaseRefresh, notifyRefresh;
	const refreshGate = new Promise((resolve) => {
		releaseRefresh = resolve;
	});
	const refreshStarted = new Promise((resolve) => {
		notifyRefresh = resolve;
	});
	await page.route(refreshRoute, async (route) => {
		notifyRefresh();
		await refreshGate;
		await route.continue();
	});
	await page.getByRole('button', { name: '应用到所选内容' }).click();
	await Promise.race([
		refreshStarted,
		delay(10000).then(() => {
			throw new Error('Batch operation did not reload the real content data');
		})
	]);
	assert.equal(await page.getByRole('status').filter({ hasText: '已对 1 条内容执行' }).count(), 0);
	assert.ok((await page.locator('.content-row-badges').textContent()).includes('草稿'));
	await page.getByRole('status').filter({ hasText: '正在保存批量操作' }).waitFor();
	releaseRefresh();
	await page.getByRole('status').filter({ hasText: '已对 1 条内容执行' }).waitFor();
	await page.unroute(refreshRoute);
	assert.ok((await page.locator('.content-row-badges').textContent()).includes('已发布'));
	assert.ok((await page.locator('.content-row-badges').textContent()).includes('私有'));
	assert.equal(await page.locator('.content-selection-bar').count(), 0);
	assert.equal(
		(
			await context.request.patch(baseUrl + '/api/admin/items/bulk', {
				data: { ids: Array.from({ length: 50 }, (_, index) => index + 1), action: 'feature' }
			})
		).status(),
		200
	);
	await page.locator('.content-category-filter').selectOption('1');
	await page.waitForURL('**category=1*');
	await page.getByRole('button', { name: '进入排序', exact: true }).click();
	await page.waitForURL('**mode=sort*');
	assert.equal(await page.locator('.content-row').count(), 123);
	const before = await page
		.locator('.content-row')
		.evaluateAll((rows) => rows.map((row) => Number(row.dataset.contentId)));
	await page.getByRole('button', { name: '下移中文资源与团队协作工具 1', exact: true }).click();
	await page.getByRole('status').filter({ hasText: '顺序已保存' }).waitFor();
	await page.reload({ waitUntil: 'networkidle' });
	const after = await page
		.locator('.content-row')
		.evaluateAll((rows) => rows.map((row) => Number(row.dataset.contentId)));
	assert.deepEqual(after, [before[1], before[0], ...before.slice(2)]);
	assert.equal(
		(
			await context.request.patch(baseUrl + '/api/admin/items/1', {
				data: {
					type: 'site',
					categoryId: 10,
					title: '中文资源与团队协作工具 1',
					slug: 'resource-1',
					status: 'published',
					visibility: 'public',
					sortOrder: 20,
					isFeatured: true,
					meta: { site_url: 'https://example.com/resource-1' }
				}
			})
		).status(),
		200
	);
	await page.goto(baseUrl + '/', { waitUntil: 'networkidle' });
	const design = page.locator('[data-category-section][id="design"]');
	await design.getByRole('tab', { name: '代码托管', exact: true }).click();
	assert.equal(await design.locator('.card-title-link[href="/sites/resource-1"]').count(), 1);
	for (const slug of ['design', 'code-hosting']) {
		assert.equal(
			(await page.goto(baseUrl + '/categories/' + slug, { waitUntil: 'networkidle' })).status(),
			200
		);
		assert.equal(
			await page.locator('.results-cards .card-title-link[href="/sites/resource-1"]').count(),
			1
		);
	}
	await open(page, '/admin/home-modules?edit=2');
	await page.getByLabel('资源分类', { exact: true }).selectOption('apps');
	await page.getByRole('button', { name: '保存模块', exact: true }).click();
	await page.waitForURL('**updated=1');
	await page.getByRole('link', { name: '编辑模块 常用开发资源', exact: true }).click();
	await page.getByLabel('资源分类', { exact: true }).waitFor();
	assert.equal(await page.getByLabel('资源分类', { exact: true }).inputValue(), 'apps');
	await page.getByText('高级配置', { exact: true }).click();
	assert.deepEqual(JSON.parse(await page.getByLabel('JSON 配置', { exact: true }).inputValue()), {
		categorySlug: 'apps',
		custom: { keep: true }
	});

	// Content entry: progressive categories, metadata fill, duplicate notice, media and unsaved guards.
	const uploaded = await context.request.post(baseUrl + '/api/admin/files', {
		headers: { origin: baseUrl, accept: 'text/html' },
		multipart: {
			file: {
				name: 'editor-icon.png',
				mimeType: 'image/png',
				buffer: Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV7sAAAAASUVORK5CYII=',
					'base64'
				)
			}
		}
	});
	assert.equal(uploaded.status(), 201);
	const mediaId = (await uploaded.json()).data.id;
	await open(page, '/admin/items?create=1');
	await page.getByRole('combobox', { name: '内容类型', exact: true }).waitFor();
	assert.deepEqual(
		await page
			.locator('select[name="type"] option')
			.evaluateAll((nodes) => nodes.map((node) => node.value)),
		['site', 'post']
	);
	await page.getByLabel('目标地址', { exact: true }).fill('https://example.com/resource-1');
	await page.getByLabel('标题', { exact: true }).fill('手动标题保留');
	await page.route('**/api/admin/items/enrich', (route) =>
		route.fulfill({
			json: {
				title: '抓取标题',
				description: '抓取用途',
				duplicates: [{ id: 1, title: '已有资源' }]
			}
		})
	);
	await page.getByRole('button', { name: '读取网页信息', exact: true }).click();
	await page.getByText(/发现已收录的网址/).waitFor();
	assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '手动标题保留');
	assert.equal(await page.getByLabel('摘要', { exact: true }).inputValue(), '抓取用途');
	await page.unroute('**/api/admin/items/enrich');
	await page.getByLabel('一级分类', { exact: true }).selectOption('9');
	await page.getByLabel('二级分类', { exact: true }).selectOption('7');
	await page.getByLabel('三级分类', { exact: true }).selectOption('10');
	assert.equal(await page.locator('input[name="categoryId"]').inputValue(), '10');
	await page.getByRole('combobox', { name: '内容类型', exact: true }).selectOption('post');
	assert.equal(await page.locator('input[name="categoryId"]').inputValue(), '');
	assert.equal(await page.locator('input[name="site_url"]').count(), 0);
	await page.getByLabel('正文', { exact: true }).fill('这是需要保存的文章正文。');
	await page.getByText('图标与封面', { exact: true }).click();
	const iconPicker = page
		.locator('.media-picker')
		.filter({ has: page.locator('input[name="iconFileId"]') });
	await iconPicker.getByRole('button', { name: '选择图片', exact: true }).click();
	await iconPicker.locator('.media-grid button').click();
	assert.equal(await page.locator('input[name="iconFileId"]').inputValue(), String(mediaId));
	page.removeAllListeners('dialog');
	page.once('dialog', (dialog) => dialog.dismiss());
	await page.getByRole('button', { name: '关闭编辑窗口', exact: true }).click();
	assert.equal(await page.getByRole('dialog').count(), 1);
	page.on('dialog', (dialog) => dialog.accept());
	const conflictResponse = await context.request.post(baseUrl + '/api/admin/items', {
		data: { type: 'post', title: '地址冲突测试', slug: 'editor-slug-conflict' }
	});
	assert.equal(conflictResponse.status(), 201);
	const conflictId = (await conflictResponse.json()).id;
	await page.getByText('更多设置', { exact: true }).click();
	await page.getByLabel('Slug', { exact: true }).fill('editor-slug-conflict');
	await page.getByRole('button', { name: '保存内容', exact: true }).click();
	await page.locator('.admin-form-message').waitFor();
	assert.equal(await page.getByRole('dialog').count(), 1);
	assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '手动标题保留');
	assert.equal(
		await page.getByLabel('正文', { exact: true }).inputValue(),
		'这是需要保存的文章正文。'
	);
	await page.getByLabel('Slug', { exact: true }).fill('');
	assert.equal(
		(await context.request.delete(baseUrl + '/api/admin/items/' + conflictId)).status(),
		204
	);
	await page.getByRole('button', { name: '保存内容', exact: true }).click();
	await page.getByRole('dialog').waitFor({ state: 'hidden' });
	await page.getByText('手动标题保留', { exact: true }).waitFor();
	await page
		.locator('.content-row')
		.filter({ hasText: '手动标题保留' })
		.getByRole('button', { name: /编辑/ })
		.click();
	assert.equal(
		await page.getByRole('combobox', { name: '内容类型', exact: true }).inputValue(),
		'post'
	);
	assert.equal(
		await page.getByLabel('正文', { exact: true }).inputValue(),
		'这是需要保存的文章正文。'
	);
	assert.equal(await page.locator('input[name="iconFileId"]').inputValue(), String(mediaId));
	await page.getByText('更多设置', { exact: true }).click();
	assert.match(
		await page.getByLabel('Slug', { exact: true }).inputValue(),
		/^[a-z0-9]+(?:-[a-z0-9]+)*$/
	);
	await page.getByRole('button', { name: '关闭编辑窗口', exact: true }).click();
	assert.equal(
		(
			await context.request.post(baseUrl + '/api/admin/items', {
				data: { type: 'app', title: '禁止新增', slug: 'rejected-app' }
			})
		).status(),
		400
	);
	await open(page, '/admin');
	assert.ok((await page.locator('.admin-task-list').textContent()).includes('1 条'));
	assert.equal(await page.locator('.admin-sidebar nav a').count(), 15);
	assert.equal(await page.locator('.admin-sidebar a[aria-current="page"]').count(), 1);
	assert.equal(await page.locator('.skip-link').getAttribute('href'), '#admin-main');
	// Task checks use only this script's temporary LOCAL bindings.
	command([
		'd1',
		'execute',
		'navinest-admin-check',
		'--local',
		'--command',
		'UPDATE hot_sources SET is_enabled=0',
		'--json'
	]);
	await open(page, '/admin/cron-runs');
	assert.equal(await page.locator('.task-card').count(), 3);
	const hotnewsCard = page
		.locator('.task-card')
		.filter({ has: page.getByRole('heading', { name: '热榜刷新', exact: true }) });
	const replayKey = await hotnewsCard.locator('input[name=requestKey]').inputValue();
	let releaseTaskRequest;
	const heldTaskRequest = new Promise((resolve) => {
		releaseTaskRequest = resolve;
	});
	await page.route(/\/admin\/cron-runs\?\/run$/, async (route) => {
		await heldTaskRequest;
		await route.continue();
	});
	await hotnewsCard.getByRole('button', { name: '立即补跑', exact: true }).click();
	await page.getByRole('button', { name: '执行中，请稍候…', exact: true }).waitFor();
	assert.equal(await page.locator('.task-card button.admin-primary-button:disabled').count(), 3);
	releaseTaskRequest();
	await page.getByRole('status').filter({ hasText: '补跑已完成' }).waitFor();
	await page.unroute(/\/admin\/cron-runs\?\/run$/);
	assert.equal(
		(
			await context.request.post(baseUrl + '/admin/cron-runs?/run', {
				form: { task: 'hotnews', requestKey: replayKey },
				headers: { origin: baseUrl, accept: 'text/html' }
			})
		).status(),
		409
	);
	assert.ok((await page.locator('.task-history').innerText()).includes('手动 · 中文管理测试账号'));
	const backupCard = page
		.locator('.task-card')
		.filter({ has: page.getByRole('heading', { name: '数据备份', exact: true }) });
	await backupCard.getByRole('button', { name: '立即补跑', exact: true }).click();
	await page
		.locator('.task-history')
		.getByText(/已保存 manual-backups/)
		.waitFor();
	const backupListing = await context.request.get(baseUrl + '/api/admin/backup/scheduled');
	const manualBackup = (await backupListing.json()).data.find((value) =>
		value.key.startsWith('manual-backups/')
	);
	assert.ok(manualBackup, 'Manual snapshot must be listed');
	const backupDownload = await context.request.get(
		baseUrl + '/api/admin/backup/scheduled?key=' + encodeURIComponent(manualBackup.key)
	);
	assert.equal(backupDownload.status(), 200);
	assert.ok((await backupDownload.json()).generatedAt);
	const cleanCard = page
		.locator('.task-card')
		.filter({ has: page.getByRole('heading', { name: '系统清理', exact: true }) });
	await cleanCard.getByRole('button', { name: '立即补跑', exact: true }).click();
	await page
		.locator('.task-history')
		.getByText(/过期会话/)
		.waitFor();
	await page.getByRole('combobox', { name: '任务', exact: true }).selectOption('backup');
	await page.getByRole('button', { name: '筛选', exact: true }).click();
	await page.waitForURL('**/admin/cron-runs?task=backup');
	assert.equal(await page.locator('.task-history tbody tr').count(), 1);
	command([
		'd1',
		'execute',
		'navinest-admin-check',
		'--local',
		'--command',
		`INSERT INTO cron_runs(cron,scheduled_at,status,started_at,result_json) VALUES('0 19 * * *',datetime('now'),'running',datetime('now','-45 minutes'),${quote(JSON.stringify({ trigger: 'manual', requestKey: 'interrupted-request-123' }))})`,
		'--json'
	]);
	await page.getByRole('button', { name: '刷新记录', exact: true }).click();
	await backupCard.getByText('长时间未完成', { exact: true }).waitFor();
	assert.equal(
		await backupCard.getByRole('button', { name: '任务运行中', exact: true }).isDisabled(),
		true
	);
	assert.equal(
		(
			await context.request.post(baseUrl + '/admin/cron-runs?/run', {
				form: { task: 'backup', requestKey: 'another-admin-request-123' },
				headers: { origin: baseUrl, accept: 'text/html' }
			})
		).status(),
		409
	);
	await backupCard.getByLabel('已核对，确认任务停止').check();
	await backupCard.getByRole('button', { name: '解除运行标记', exact: true }).click();
	await page.getByRole('status').filter({ hasText: '运行标记已解除' }).waitFor();
	assert.equal(
		await backupCard.getByRole('button', { name: '立即补跑', exact: true }).isEnabled(),
		true
	);
	command([
		'd1',
		'execute',
		'navinest-admin-check',
		'--local',
		'--command',
		"UPDATE hot_sources SET is_enabled=1,url='http://127.0.0.1/private'",
		'--json'
	]);
	await hotnewsCard.getByRole('button', { name: '立即补跑', exact: true }).click();
	await page.getByRole('alert').filter({ hasText: '存在刷新失败的来源' }).waitFor();
	assert.ok((await hotnewsCard.innerText()).includes('失败 1'));
	await page.getByRole('combobox', { name: '任务', exact: true }).selectOption('all');
	await page.getByRole('button', { name: '筛选', exact: true }).click();
	await page.waitForURL('**/admin/cron-runs?task=all');
	await page.locator('.task-history details summary').first().click();
	assert.ok((await page.locator('.task-history details').first().innerText()).includes('失败'));
	await open(page, '/admin');
	const cdp = await context.newCDPSession(page);
	await cdp.send('DOM.enable');
	await cdp.send('CSS.enable');
	const { root } = await cdp.send('DOM.getDocument');
	const { nodeId } = await cdp.send('DOM.querySelector', {
		nodeId: root.nodeId,
		selector: '.admin-page-header h1'
	});
	const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
	console.log(
		'Admin Chinese fonts:',
		fonts.map((font) => `${font.familyName} (${font.glyphCount})`).join(', ')
	);
	if (process.env.NAVINEST_REQUIRE_CJK === '1')
		assert.ok(
			fonts.some(
				(font) =>
					font.glyphCount > 0 && /CJK|YaHei|PingFang|WenQuanYi|Heiti|Songti/i.test(font.familyName)
			)
		);
	await cdp.detach();
	const primary = [
		'/admin',
		'/admin/items',
		'/admin/home-modules',
		'/admin/categories',
		'/admin/settings',
		'/admin/users',
		'/admin/cron-runs'
	];
	const other = [
		'/admin/tags',
		'/admin/submissions',
		'/admin/files',
		'/admin/search-engines',
		'/admin/hot-sources',
		'/admin/messages',
		'/admin/ai-providers',
		'/admin/import-export'
	];
	for (const path of [...primary, ...other])
		for (const width of primary.includes(path)
			? [320, 375, 768, 1024, 1366, 1920, 2560]
			: [375, 1366])
			for (const theme of ['light', 'dark']) {
				await page.setViewportSize({ width, height: 900 });
				await open(page, path);
				if ((await page.getByLabel('切换深色模式').isChecked()) !== (theme === 'dark'))
					await page.locator('.theme-toggle').click();
				await page.waitForFunction(
					(theme) => document.documentElement.dataset.theme === theme,
					theme
				);
				const state = await page.evaluate(() => {
					const sample =
						document.querySelector('.admin-page-description') ??
						document.querySelector('.admin-breadcrumb a');
					const background = getComputedStyle(
						document.querySelector('.admin-shell')
					).backgroundColor;
					return {
						overflow: document.documentElement.scrollWidth - innerWidth,
						foreground: getComputedStyle(sample).color,
						background,
						controls: [
							...document.querySelectorAll(
								'.admin-primary-button,.admin-secondary-button,.content-edit-button,.content-row-menu summary,.content-type-tabs a,.admin-menu-button,.admin-filter-bar input,.admin-filter-bar select'
							)
						]
							.filter((node) => node.getClientRects().length > 0)
							.map((node) => ({
								text: node.textContent,
								rect: node.getBoundingClientRect().height
							})),
						head: getComputedStyle(document.querySelector('.admin-page-header h1')).color
					};
				});

				if (path === '/admin/users') {
					assert.equal(
						await page.locator('.admin-filter-bar input, .admin-filter-bar select').count(),
						3
					);
					const filter = await page.locator('.admin-filter-bar input').evaluate((node) => ({
						foreground: getComputedStyle(node).color,
						background: getComputedStyle(node).backgroundColor,
						placeholder: getComputedStyle(node, '::placeholder').color
					}));
					assert.ok(
						contrast(filter.foreground, filter.background) >= 4.5,
						'User filter text must be readable'
					);
					assert.ok(
						contrast(filter.placeholder, filter.background) >= 4.5,
						'User filter placeholder must be readable'
					);
					if (theme === 'dark')
						assert.ok(
							filter.background
								.match(/[\d.]+/g)
								.slice(0, 3)
								.map(Number)
								.every((channel) => channel < 128),
							'User filters must follow the dark theme'
						);
				}

				if (path === '/admin/cron-runs') {
					const cards = await page.locator('.task-card').evaluateAll((cards) =>
						cards.map((card) => ({
							background: getComputedStyle(card).backgroundColor,
							state: getComputedStyle(card.querySelector('.task-state')).color,
							buttonTop: card.querySelector('button.admin-primary-button').getBoundingClientRect()
								.top
						}))
					);
					assert.equal(cards.length, 3);
					for (const card of cards)
						assert.ok(
							contrast(card.state, card.background) >= 4.5,
							'Task status text must be readable'
						);
					if (width >= 1366)
						assert.ok(
							Math.max(...cards.map((card) => card.buttonTop)) -
								Math.min(...cards.map((card) => card.buttonTop)) <=
								1,
							'Task actions must align at the bottom of desktop cards'
						);
				}
				const label = `${path} ${width}px ${theme}`;
				if (path === '/admin/categories') await checkCategoryLabels(page);
				assert.ok(state.overflow <= 1, `${label}: page overflow ${state.overflow}`);
				assert.ok(
					contrast(state.foreground, state.background) >= 4.5,
					`${label}: low text contrast`
				);
				for (const control of state.controls)
					assert.ok(control.rect >= 44, `${label}: ${control.text} height ${control.rect}`);
				assert.equal(await page.locator('.admin-sidebar a[aria-current="page"]').count(), 1);
				if (primary.includes(path) && [320, 1366].includes(width))
					await shot(page, `${path.split('/').at(-1)}-${width}-${theme}`);
				layouts++;
			}

	for (const path of [
		'/admin/items?edit=123',
		'/admin/items?create=1&type=post',
		'/admin/home-modules?edit=2',
		'/admin/home-modules?edit=1',
		'/admin/categories?create=1&parent=1',
		'/admin/categories?edit=2',
		'/admin/categories?edit=10',
		'/admin/categories?create=1&parent=7'
	])
		for (const width of [320, 1366])
			for (const theme of ['light', 'dark']) {
				await page.setViewportSize({ width, height: 900 });
				// Establish theme before opening the dialog, because the modal isolates its header.
				await open(page, '/admin');
				if ((await page.getByLabel('切换深色模式').isChecked()) !== (theme === 'dark'))
					await page.locator('.theme-toggle').click();
				await open(page, path);
				if (path.startsWith('/admin/items')) await page.getByRole('dialog').waitFor();
				const state = await page.evaluate(() => ({
					overflow: document.documentElement.scrollWidth - innerWidth,
					modal: document.querySelector('.content-editor-modal')?.getBoundingClientRect().width,
					fields: [
						...document.querySelectorAll(
							'.admin-form input:not([type="hidden"]):not([type="checkbox"]),.admin-form select,.admin-form textarea'
						)
					]
						.filter((node) => node.getClientRects().length)
						.map((node) => ({
							name: node.name,
							hasPlaceholder: Boolean(node.getAttribute('placeholder')),
							placeholder: getComputedStyle(node, '::placeholder').color,
							background: getComputedStyle(node).backgroundColor,
							width: node.getBoundingClientRect().width,
							height: node.getBoundingClientRect().height
						}))
				}));
				assert.ok(state.overflow <= 1, `${path} ${width} ${theme}: editor page overflow`);
				if (state.modal) assert.ok(state.modal <= width, 'Dialog must fit its viewport');
				for (const field of state.fields) {
					assert.ok(field.width >= 120, `${field.name}: field too narrow`);
					assert.ok(field.height >= 44, `${field.name}: field too short`);
					if (field.hasPlaceholder)
						assert.ok(
							contrast(field.placeholder, field.background) >= 4.5,
							`${path} ${theme}: ${field.name} placeholder must be readable`
						);
				}
				if (path.startsWith('/admin/categories')) {
					assert.equal(await page.getByRole('group', { name: '父级分类', exact: true }).count(), 1);
					if (width > 760 && (await page.locator('select[name="type"]').count())) {
						const alignment = await page.evaluate(() => {
							const metrics = (node) => {
								const rect = node.getBoundingClientRect();
								const label = node.closest('label').querySelector('span').getBoundingClientRect();
								return { top: rect.top, bottom: rect.bottom, labelTop: label.top };
							};
							return {
								type: metrics(document.querySelector('select[name="type"]')),
								parents: [...document.querySelectorAll('.parent-selection-levels select')].map(
									metrics
								)
							};
						});
						assert.ok(alignment.parents.length > 0, 'Parent selectors must be visible');
						assert.ok(
							Math.abs(alignment.parents[0].top - alignment.type.top) <= 1,
							`${path} ${theme}: type and parent controls must start on the same line`
						);
						for (const parent of alignment.parents.filter(
							(field) => Math.abs(field.top - alignment.parents[0].top) <= 1
						)) {
							assert.ok(
								Math.abs(parent.labelTop - alignment.type.labelTop) <= 1,
								`${path} ${theme}: first-row category labels must align`
							);
							assert.ok(
								Math.abs(parent.bottom - alignment.type.bottom) <= 1,
								`${path} ${theme}: first-row category controls must have equal height`
							);
						}
					}
				}
				const scenario = {
					'/admin/categories?create=1&parent=1': 'category-create',
					'/admin/categories?edit=2': 'category-legacy-editor',
					'/admin/categories?edit=10': 'category-parent-editor',
					'/admin/categories?create=1&parent=7': 'category-parent-cascade',
					'/admin/items?edit=123': 'editor',
					'/admin/items?create=1&type=post': 'article-editor',
					'/admin/home-modules?edit=2': 'module-category',
					'/admin/home-modules?edit=1': 'module-search'
				}[path];
				await shot(page, `${scenario}-${width}-${theme}`);
				layouts++;
			}
	for (const width of [320, 1366])
		for (const theme of ['light', 'dark']) {
			await page.setViewportSize({ width, height: 900 });
			await open(page, '/admin/categories');
			if ((await page.getByLabel('切换深色模式').isChecked()) !== (theme === 'dark'))
				await page.locator('.theme-toggle').click();
			await page.locator('.category-legacy summary').click();
			await checkCategoryLabels(page);
			assert.ok(
				await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1),
				'Expanded legacy categories must fit the viewport'
			);
			assert.ok(
				await page
					.locator('.category-legacy summary')
					.evaluate((node) => node.getBoundingClientRect().height >= 44),
				'Legacy categories keyboard/touch target'
			);
			await shot(page, `category-legacy-expanded-${width}-${theme}`);
			layouts++;
		}
	assert.equal((await context.request.get(baseUrl + '/user/settings')).status(), 200);
	assert.equal(
		(await context.request.get(baseUrl + '/api/auth/github', { maxRedirects: 0 })).status(),
		503
	);
	await open(page, '/admin/home-modules');
	await page.setViewportSize({ width: 320, height: 900 });
	assert.ok(
		await page
			.locator('.admin-module-copy')
			.evaluateAll((nodes) => nodes.every((node) => node.getBoundingClientRect().width >= 160)),
		'Module descriptions need readable mobile space'
	);
	for (const theme of ['light', 'dark']) {
		await page.setViewportSize({ width: 375, height: 900 });
		await open(page, '/admin/items');
		if ((await page.getByLabel('切换深色模式').isChecked()) !== (theme === 'dark'))
			await page.locator('.theme-toggle').click();
		await page.getByRole('button', { name: '打开后台菜单', exact: true }).click();
		await page.getByRole('dialog', { name: '后台菜单', exact: true }).waitFor();
		assert.equal(
			await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
			'关闭后台菜单'
		);
		assert.equal(await page.locator('.admin-workspace').evaluate((node) => node.inert), true);
		assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
		await page.keyboard.press('Shift+Tab');
		assert.ok(
			await page.locator('.admin-public-link').evaluate((node) => node === document.activeElement)
		);
		await page.keyboard.press('Tab');
		assert.equal(
			await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
			'关闭后台菜单'
		);
		await shot(page, 'menu-375-' + theme);
		await page.keyboard.press('Escape');
		assert.equal(
			await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
			'打开后台菜单'
		);
		assert.equal(await page.locator('.admin-workspace').evaluate((node) => node.inert), false);
		await page.getByRole('button', { name: '打开后台菜单', exact: true }).click();
		await page.setViewportSize({ width: 1366, height: 900 });
		await page.getByRole('dialog', { name: '后台菜单', exact: true }).waitFor({ state: 'hidden' });
		assert.equal(await page.evaluate(() => document.body.style.overflow), '');
	}
	await page.setViewportSize({ width: 320, height: 900 });
	await open(page, '/admin/users');
	const region = page.getByRole('region', { name: '管理数据列表，可横向滚动' });
	assert.equal(await region.getAttribute('tabindex'), '0');
	await region.focus();
	await page.keyboard.press('ArrowRight');
	await page.waitForFunction(() => document.querySelector('.admin-table-wrap').scrollLeft > 0);
	layouts += await checkSubmissionReview({ page, baseUrl, command, screenshots, userToken });
	layouts += await checkContributionFlow({ browser, baseUrl, command, screenshots, userToken });
	layouts += await checkMediaLibrary({
		browser,
		baseUrl,
		command,
		screenshots,
		userToken,
		adminToken
	});
	layouts += await checkUserSubmissions({ browser, baseUrl, command, screenshots, userToken });
	assert.deepEqual(errors, [], 'Administration produced browser runtime errors');
	console.log(
		`Admin workspace: authorization, cascading category parents and native forms, descendant content, category types and legacy preservation, pagination, filters, editor save, bulk updates, complete ordering, config preservation, keyboard navigation and ${layouts} CJK layouts passed.`
	);
	if (screenshots)
		writeFileSync(
			join(screenshots, 'verification.json'),
			JSON.stringify(
				{
					layouts,
					fonts,
					errors,
					checks: [
						'authorization',
						'website/article categories and same-type parents',
						'cascading parent path restoration and upper-level reset',
						'category type and first-row parent label/control alignment',
						'self and descendant parent exclusion and cycle rejection',
						'JavaScript-disabled native category form',
						'descendant content in homepage branches and category pages',
						'legacy category maintenance and retired type rejection',
						'category label wrapping and contrast',
						'pagination',
						'URL filters',
						'editor refresh',
						'bulk scope',
						'bulk completion after rendered refresh',
						'full-category ordering',
						'config preservation',
						'menu focus',
						'keyboard table scroll',
						'submission review pagination, reconciliation and native forms',
						'website/article contributions, category paths, AI preservation and native submission',
						'owned submission history, full pagination, private details, feedback, native revisions and duplicate protection'
					]
				},
				null,
				2
			)
		);
} catch (error) {
	if (page && screenshots) {
		await shot(page, 'failure');
		writeFileSync(join(screenshots, 'failure.html'), await page.content());
		writeFileSync(join(screenshots, 'failure-worker.log'), output);
	}
	throw error;
} finally {
	await browser?.close();
	server?.kill('SIGTERM');
	if (server) await Promise.race([new Promise((done) => server.once('exit', done)), delay(5000)]);
	rmSync(temporary, { recursive: true, force: true });
}
