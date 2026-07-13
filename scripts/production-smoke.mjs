import { chromium } from 'playwright';
import {
	baseUrl,
	machineRoutes,
	protectedRoutes,
	publicRoutes,
	requiredHeaders,
	safeTargets,
	viewports
} from './production-smoke-config.mjs';
function assert(condition, message) {
	if (!condition) throw new Error(message);
}
function sanitizeLocation(value) {
	if (!value) return null;
	try {
		const url = new URL(value, baseUrl);
		return value.startsWith('/') ? url.pathname : `${url.origin}${url.pathname}`;
	} catch {
		return null;
	}
}
async function assertHeaders(response, route) {
	const playwrightHeaders = response.allHeaders ? await response.allHeaders() : null;
	for (const [name, expected] of Object.entries(route.requiredHeaders ?? requiredHeaders)) {
		const actual = playwrightHeaders?.[name] ?? response.headers.get(name) ?? '';
		assert(actual.includes(expected), `${route.path}: ${name} missing ${expected}`);
	}
}
const report = {
	baseUrl,
	startedAt: new Date().toISOString(),
	public: [],
	protected: [],
	machine: []
};
for (const route of protectedRoutes) {
	const response = await fetch(new URL(route.path, baseUrl), { redirect: 'manual' });
	assert(
		route.expected.includes(response.status),
		`${route.path}: expected ${route.expected.join('/')} but received ${response.status}`
	);
	report.protected.push({
		path: route.path,
		status: response.status,
		location: sanitizeLocation(response.headers.get('location'))
	});
}
for (const route of machineRoutes) {
	const url = new URL(route.path, baseUrl);
	url.searchParams.set('_smoke', Date.now().toString());
	const response = await fetch(url);
	const body = await response.text();
	assert(response.status === route.expectedStatus, `${route.path}: HTTP ${response.status}`);
	await assertHeaders(response, route);
	assert(
		response.headers.get('content-type')?.includes(route.contentType),
		`${route.path}: invalid content type`
	);
	for (const value of route.includes)
		assert(body.includes(value), `${route.path}: missing ${value}`);
	report.machine.push({
		path: route.path,
		status: response.status,
		contentType: response.headers.get('content-type')
	});
}
const browser = await chromium.launch({ headless: true });
try {
	const gatewayPage = await browser.newPage();
	for (const check of safeTargets) {
		const url = new URL('/go', baseUrl);
		url.searchParams.set('url', check.target);
		await gatewayPage.goto(url.toString(), { waitUntil: 'networkidle', timeout: 60000 });
		const continueLink = gatewayPage.getByRole('link', { name: '继续访问' });
		assert(
			(await continueLink.count()) === (check.valid ? 1 : 0),
			`/go validation failed: ${check.target}`
		);
	}
	await gatewayPage.close();
	for (const viewport of viewports) {
		for (const route of publicRoutes) {
			const page = await browser.newPage({
					viewport: { width: viewport.width, height: viewport.height }
				}),
				errors = [];
			page.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text());
			});
			page.on('pageerror', (error) => errors.push(error.message));
			const url = new URL(route.path, baseUrl);
			url.searchParams.set('_smoke', Date.now().toString());
			const response = await page.goto(url.toString(), {
				waitUntil: 'networkidle',
				timeout: 60000
			});
			assert(
				response?.status() === (route.expectedStatus ?? 200),
				`${viewport.name} ${route.path}: HTTP ${response?.status()}`
			);
			await assertHeaders(response, route);
			const result = await page.evaluate(
				({ selector }) => ({
					h1: document.querySelectorAll('h1').length,
					hasSelector: Boolean(document.querySelector(selector)),
					scrollWidth: document.documentElement.scrollWidth,
					bodyWidth: Math.round(document.body.getBoundingClientRect().width),
					cards: document.querySelectorAll('.results-cards article').length,
					tabs: document.querySelectorAll('.category-child-tabs a').length,
					robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
					external: [...document.querySelectorAll('.detail-actions a')].map((link) =>
						link.getAttribute('href')
					)
				}),
				{ selector: route.selector }
			);
			assert(
				result.h1 === 1,
				`${viewport.name} ${route.path}: expected one h1, received ${result.h1}`
			);
			assert(result.hasSelector, `${viewport.name} ${route.path}: missing ${route.selector}`);
			assert(
				result.scrollWidth <= viewport.width,
				`${viewport.name} ${route.path}: horizontal overflow ${result.scrollWidth}>${viewport.width}`
			);
			assert(
				route.ignoreResourceErrors || errors.length === 0,
				`${viewport.name} ${route.path}: console errors: ${errors.join(' | ')}`
			);
			if (route.noindex)
				assert(
					result.robots?.includes('noindex'),
					`${viewport.name} ${route.path}: missing noindex`
				);
			if (route.minimumCards !== undefined)
				assert(
					result.cards >= route.minimumCards,
					`${viewport.name} ${route.path}: expected >=${route.minimumCards} cards, received ${result.cards}`
				);
			if (route.tabs !== undefined)
				assert(
					result.tabs === route.tabs,
					`${viewport.name} ${route.path}: expected ${route.tabs} tabs, received ${result.tabs}`
				);
			if (route.safeExternal)
				assert(
					result.external.length > 0 &&
						result.external.every((href) => href?.startsWith('/go?url=')),
					`${viewport.name} ${route.path}: unsafe external link`
				);
			if (viewport.name === 'mobile' && route.mobileMenu) {
				const menu = page.locator(route.mobileMenu.button);
				await menu.click();
				await page.waitForTimeout(100);
				assert(
					(await menu.getAttribute('aria-expanded')) === 'true',
					`mobile ${route.path}: menu did not open`
				);
				assert(
					(await page.locator(route.mobileMenu.drawer).count()) === 1,
					`mobile ${route.path}: drawer missing`
				);
			}
			report.public.push({
				viewport: viewport.name,
				name: route.name,
				path: route.path,
				status: response.status(),
				...result,
				errors
			});
			await page.close();
		}
	}
} finally {
	await browser.close();
}
report.finishedAt = new Date().toISOString();
console.log(JSON.stringify(report, null, 2));
