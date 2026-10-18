export const LINK_CHECK_BATCH_SIZE = 3;
export const linkCheckLabels = {
	unchecked: '尚未检查',
	reachable: '可访问',
	redirected: '发生跳转',
	gone: '404 / 410',
	uncertain: '待核实',
	blocked: '无法检查',
	stale: '网址已改，待重查'
} as const;
export type LinkCheckStatus = keyof typeof linkCheckLabels;
export type LinkCheckResult = {
	url: string;
	status: Exclude<LinkCheckStatus, 'unchecked' | 'stale'>;
	httpStatus: number | null;
	finalUrl: string | null;
	reason: string;
	checkedAt: string;
};
export const linkCheckReasons: Record<string, string> = {
	ok: '服务器响应成功；不代表页面内容或登录权限已核实。',
	http: '仅记录 HTTP 响应；403、限流或服务器异常需人工核实。',
	missing: '尚未填写网址，请先编辑补充。',
	unsafe: '地址或解析结果未通过安全检查。',
	dns: '域名暂时无法解析，不能据此判断网址失效。',
	timeout: '检查超时，不能据此判断网址失效。',
	network: '连接未完成，请稍后核实。',
	'redirect-limit': '跳转次数较多，请人工核实。',
	'redirect-invalid': '跳转目标缺失或格式无效。',
	'redirect-loop': '检测到循环跳转。'
};
export function linkCheckFilters(params: URLSearchParams) {
	const status = params.get('result') ?? 'all';
	return {
		q: (params.get('q') ?? '').trim().slice(0, 160),
		result: status in linkCheckLabels && Object.hasOwn(linkCheckLabels, status) ? status : 'all',
		page: /^\d{1,7}$/.test(params.get('page') ?? '') ? Math.max(1, Number(params.get('page'))) : 1
	};
}
export function linkCheckUrl(params: URLSearchParams, page?: number) {
	const filters = linkCheckFilters(params),
		query = new URLSearchParams();
	if (filters.q) query.set('q', filters.q);
	if (filters.result !== 'all') query.set('result', filters.result);
	if ((page ?? filters.page) > 1) query.set('page', String(page ?? filters.page));
	return '/admin/link-checks' + (query.size ? '?' + query.toString() : '');
}
