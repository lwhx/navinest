import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

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
	"INSERT INTO categories(id,type,name,slug) VALUES(1,'site','开发工具与团队协作资源','tools'),(2,'app','软件资源','apps'); INSERT INTO tags(id,type,name,slug) VALUES(1,'site','团队协作','collaboration');"
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
	await context.addCookies([{ name: 'navinest_session', value: adminToken, url: baseUrl }]);
	page = await context.newPage();
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('dialog', (dialog) => dialog.accept());
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
	await page.getByRole('button', { name: '应用到所选内容' }).click();
	await page.getByRole('status').filter({ hasText: '已对 1 条内容执行' }).waitFor();
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
	await open(page, '/admin');
	assert.ok((await page.locator('.admin-task-list').textContent()).includes('1 条'));
	assert.equal(await page.locator('.admin-sidebar nav a').count(), 15);
	assert.equal(await page.locator('.admin-sidebar a[aria-current="page"]').count(), 1);
	assert.equal(await page.locator('.skip-link').getAttribute('href'), '#admin-main');
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
		'/admin/users'
	];
	const other = [
		'/admin/tags',
		'/admin/submissions',
		'/admin/files',
		'/admin/search-engines',
		'/admin/hot-sources',
		'/admin/messages',
		'/admin/ai-providers',
		'/admin/cron-runs',
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
								'.admin-primary-button,.admin-secondary-button,.content-edit-button,.content-row-menu summary,.content-type-tabs a,.admin-menu-button,.admin-user-filters input,.admin-user-filters select'
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
				const label = `${path} ${width}px ${theme}`;
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
		'/admin/home-modules?edit=2',
		'/admin/home-modules?edit=1'
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
							width: node.getBoundingClientRect().width,
							height: node.getBoundingClientRect().height
						}))
				}));
				assert.ok(state.overflow <= 1, `${path} ${width} ${theme}: editor page overflow`);
				if (state.modal) assert.ok(state.modal <= width, 'Dialog must fit its viewport');
				for (const field of state.fields) {
					assert.ok(field.width >= 120, `${field.name}: field too narrow`);
					assert.ok(field.height >= 44, `${field.name}: field too short`);
				}
				await shot(
					page,
					`${path.startsWith('/admin/items') ? 'editor' : path.endsWith('2') ? 'module-category' : 'module-search'}-${width}-${theme}`
				);
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
	assert.deepEqual(errors, [], 'Administration produced browser runtime errors');
	console.log(
		`Admin workspace: authorization, pagination, filters, editor save, bulk updates, complete ordering, config preservation, keyboard navigation and ${layouts} CJK layouts passed.`
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
						'pagination',
						'URL filters',
						'editor refresh',
						'bulk scope',
						'full-category ordering',
						'config preservation',
						'menu focus',
						'keyboard table scroll'
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
	}
	throw error;
} finally {
	await browser?.close();
	server?.kill('SIGTERM');
	if (server) await Promise.race([new Promise((done) => server.once('exit', done)), delay(5000)]);
	rmSync(temporary, { recursive: true, force: true });
}
