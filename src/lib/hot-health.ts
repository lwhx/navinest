export const HOT_STALE_HOURS = 48;
export const HOT_REMINDER_DAYS = 7;
export type HotHealthKind = 'disabled' | 'refreshing' | 'failed' | 'waiting' | 'stale' | 'healthy';
export function hotTimestamp(value: string | null | undefined) {
	if (!value) return null;
	const n = Date.parse(
		value.replace(' ', 'T') + (/([zZ]|[+-]\d{2}:\d{2})$/.test(value) ? '' : 'Z')
	);
	return Number.isFinite(n) ? n : null;
}
export function hotHealth(
	source: {
		isEnabled?: boolean;
		lastSuccessAt: string | null;
		lastError?: string | null;
		hasError?: boolean;
		refreshToken?: string | null;
		isRefreshing?: boolean;
		refreshStartedAt?: string | null;
		itemCount?: number;
	},
	now = Date.now()
) {
	if (source.isEnabled === false)
		return { kind: 'disabled' as const, label: '已停用', detail: '不参与自动刷新与异常提醒' };
	const started = hotTimestamp(source.refreshStartedAt);
	if ((source.refreshToken || source.isRefreshing) && started !== null && started > now - 300000)
		return {
			kind: 'refreshing' as const,
			label: '刷新中',
			detail: '正在获取数据，现有缓存继续保留'
		};
	if (source.lastError || source.hasError)
		return {
			kind: 'failed' as const,
			label: '刷新失败',
			detail: source.itemCount === 0 ? '尚无可用缓存，需检查订阅' : '显示上次成功数据'
		};
	const success = hotTimestamp(source.lastSuccessAt);
	if (success === null)
		return {
			kind: 'waiting' as const,
			label: '尚未验证',
			detail: source.itemCount ? '现有缓存尚无本次配置的成功记录' : '等待首次成功刷新'
		};
	if (success < now - HOT_STALE_HOURS * 3600000)
		return {
			kind: 'stale' as const,
			label: '内容过期',
			detail: `超过 ${HOT_STALE_HOURS} 小时未成功更新`
		};
	return { kind: 'healthy' as const, label: '更新正常', detail: '已保留最近一次成功缓存' };
}
export function hotDate(value: string | null | undefined) {
	const timestamp = hotTimestamp(value);
	return timestamp === null
		? '暂无记录'
		: new Intl.DateTimeFormat('zh-CN', {
				timeZone: 'Asia/Shanghai',
				dateStyle: 'medium',
				timeStyle: 'short'
			}).format(timestamp);
}
export type HotErrorCode =
	| 'network'
	| 'timeout'
	| 'http'
	| 'parse'
	| 'empty'
	| 'too_large'
	| 'unsafe'
	| 'configuration'
	| 'conflict'
	| 'storage';
export function hotErrorDetail(message: string, code?: HotErrorCode) {
	const kind =
		code ??
		(/缓存写入|数据库|原子刷新/.test(message)
			? 'storage'
			: /请求头或解析配置|配置无效/.test(message)
				? 'configuration'
				: /HTTP\s*\d{3}/i.test(message)
					? 'http'
					: /超时|abort|timeout/i.test(message)
						? 'timeout'
						: /过大/.test(message)
							? 'too_large'
							: /私网|保留地址|不安全|公网|凭据/.test(message)
								? 'unsafe'
								: /JSON|RSS|Atom|HTML|解析|选择器/.test(message)
									? 'parse'
									: /条目|为空/.test(message)
										? 'empty'
										: /租约|变化|正在刷新/.test(message)
											? 'conflict'
											: 'network');
	const labels: Record<HotErrorCode, string> = {
		network: '网络请求失败',
		timeout: '请求超时',
		http: '源站返回错误',
		parse: '订阅解析失败',
		empty: '没有有效条目',
		too_large: '响应超过限制',
		unsafe: '请求目标不安全',
		configuration: '订阅配置无效',
		conflict: '刷新状态已变化',
		storage: '缓存写入失败'
	};
	const tips: Record<HotErrorCode, string> = {
		network: '核对订阅地址及源站可用性，稍后重试。',
		timeout: '源站响应较慢，可稍后重试或更换稳定订阅。',
		http: '核对源站是否限制访问，或订阅地址是否失效。',
		parse: '检查返回内容是否仍为所选格式，核对数组路径、字段或选择器。',
		empty: '核对上游是否有内容，以及标题和链接字段是否有效。',
		too_large: '请使用更精简的订阅接口，单次响应最多 2 MiB。',
		unsafe: '仅支持安全的公网 HTTP/HTTPS 目标，重定向也必须符合要求。',
		configuration: '修正请求头或解析配置后重新检查。',
		conflict: '刷新已被其他操作替代，请重新读取当前配置。',
		storage: '旧缓存继续保留，请稍后重试并核对结果。'
	};
	return { code: kind, label: labels[kind], tip: tips[kind] };
}
