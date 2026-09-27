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
	for (const check of safeTargets) {
		const url = new URL('/go', baseUrl);
		url.searchParams.set('url', check.target);
		const response = await fetch(url, { redirect: 'manual' });
		if (check.valid) {
			assert(response.status === 302, `/go expected direct redirect: ${check.target}`);
			assert(
				response.headers.get('location') === check.target,
				`/go redirect target mismatch: ${check.target}`
			);
		} else {
			assert(response.status === 200, `/go invalid target should render error: ${check.target}`);
			assert(
				(await response.text()).includes('无法打开此地址'),
				`/go invalid target error missing: ${check.target}`
			);
		}
	}
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
			const policy =
				(await response.allHeaders())['content-security-policy'] ??
				response.headers.get('content-security-policy') ??
				'';
			const nonce = /'nonce-([A-Za-z0-9_-]+)'/.exec(policy)?.[1];
			assert(nonce, `${viewport.name} ${route.path}: missing CSP nonce`);
			assert(
				!policy.includes("script-src 'self' 'unsafe-inline'"),
				`${viewport.name} ${route.path}: inline scripts still allowed`
			);
			const scripts = await page.evaluate(() => {
				const nodes = [...document.querySelectorAll('script')];
				return {
					total: nodes.length,
					nonces: [...new Set(nodes.map((node) => node.nonce || node.getAttribute('nonce') || ''))]
				};
			});
			assert(scripts.total > 0, `${viewport.name} ${route.path}: no scripts found`);
			assert(
				scripts.nonces.length === 1 && scripts.nonces[0] === nonce,
				`${viewport.name} ${route.path}: script nonce mismatch ${JSON.stringify(scripts.nonces)}`
			);
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
