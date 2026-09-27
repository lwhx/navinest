export const baseUrl = process.env.NAVINEST_SMOKE_URL ?? 'https://nss.whks.de';
export const viewports = [
	{ name: 'desktop', width: 1920, height: 911 },
	{ name: 'mobile', width: 390, height: 844 }
];
export const requiredHeaders = {
	'content-security-policy': "frame-ancestors 'none'",
	'strict-transport-security': 'max-age=31536000',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'permissions-policy': 'camera=()'
};
export const publicRoutes = [
	{
		name: 'home',
		path: '/',
		selector: '.home-module-flow',
		mobileMenu: { button: '.mobile-menu-button', drawer: '.mobile-drawer' }
	},
	{ name: 'search-vite', path: '/search?q=Vite', selector: '.results-cards', minimumCards: 1 },
	{
		name: 'category-development',
		path: '/categories/dev-tools',
		selector: '.results-cards',
		minimumCards: 5,
		tabs: 4,
		mobileMenu: { button: '.public-menu-button', drawer: '.public-mobile-drawer' }
	},
	{
		name: 'category-frontend',
		path: '/categories/frontend-dev',
		selector: '.results-cards',
		minimumCards: 3,
		tabs: 0
	},
	{ name: 'tag-development', path: '/tags/dev', selector: '.results-cards' },
	{ name: 'site-detail', path: '/sites/vite', selector: '.product-detail', safeExternal: true },
	{ name: 'post-detail', path: '/posts/building-a-quiet-start-space', selector: '.product-detail' },
	{ name: 'app-detail', path: '/apps/notion', selector: '.product-detail', safeExternal: true },
	{
		name: 'book-detail',
		path: '/books/design-of-everyday-things',
		selector: '.product-detail',
		safeExternal: true
	},
	{ name: 'bulletin-detail', path: '/bulletins/navinest-preview', selector: '.product-detail' },
	{ name: 'rankings', path: '/rankings', selector: '.ranking-periods' },
	{ name: 'hotnews', path: '/hotnews', selector: '.hotnews-hero' },
	{ name: 'login', path: '/login', selector: '.account-login' },
	{
		name: 'not-found',
		path: '/__smoke_missing__',
		selector: '.error-page',
		expectedStatus: 404,
		noindex: true,
		ignoreResourceErrors: true
	}
];
export const machineRoutes = [
	{
		path: '/robots.txt',
		expectedStatus: 200,
		contentType: 'text/plain',
		includes: ['Sitemap:', 'Disallow: /admin']
	},
	{
		path: '/sitemap.xml',
		expectedStatus: 200,
		contentType: 'application/xml',
		includes: ['<urlset', '/sites/vite', '/apps/notion']
	}
];
export const protectedRoutes = [
	{ path: '/user', expected: [302, 303] },
	{ path: '/user/settings', expected: [302, 303] },
	{ path: '/admin', expected: [301, 302, 303, 401, 403] }
];
export const safeTargets = [
	{ target: 'javascript:alert(1)', valid: false },
	{ target: 'http://127.0.0.1/', valid: false },
	{ target: 'http://169.254.169.254/', valid: false },
	{ target: 'https://user:pass@example.com/', valid: false },
	{ target: 'https://example.com/', valid: true }
];
