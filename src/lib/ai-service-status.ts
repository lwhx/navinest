export const aiFailureInfo = {
	address: {
		label: '地址或模型不可用',
		advice:
			'检查 API Base URL、模型名称与公网可达性。地址填写到 API 根路径，系统会追加 /chat/completions。'
	},
	authentication: {
		label: '密钥或权限无效',
		advice: '检查 API Key 是否有效，以及是否有权使用当前模型。'
	},
	timeout: {
		label: '请求超时',
		advice: '检查服务响应速度；必要时在高级参数中调整超时后重新测试。'
	},
	network: { label: '网络连接失败', advice: '检查服务域名、网络连接与证书后重试。' },
	invalid_response: {
		label: '返回格式异常',
		advice: '服务需要支持 Chat Completions，并返回包含标题、简介和说明的结构化 JSON。'
	},
	rate_limit: { label: '限流或配额不足', advice: '稍后重试，并检查上游账户额度与调用限制。' },
	upstream: { label: '上游服务异常', advice: '检查服务商运行状态后重试。' },
	configuration: {
		label: '配置不可用',
		advice: '检查服务配置及服务器加密密钥；保存修改后重新测试。'
	},
	stale: {
		label: '配置已变化',
		advice: '本次结果对应旧配置，未更新测试状态。请重新测试已保存配置。'
	},
	webpage: {
		label: '网页读取失败',
		advice: '目标网页未能读取，尚未开始 AI 生成；可更换地址或手动填写。'
	},
	unknown: { label: '处理失败', advice: '请重试或查看对应阶段，仍可手动填写内容。' }
} as const;
export type AiFailureCode = keyof typeof aiFailureInfo;
export function aiFailure(code: string | null | undefined) {
	return aiFailureInfo[code as AiFailureCode] ?? aiFailureInfo.unknown;
}
export function aiTime(value: string | null) {
	if (!value) return '—';
	const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z');
	return Number.isNaN(date.getTime())
		? '—'
		: new Intl.DateTimeFormat('zh-CN', {
				timeZone: 'Asia/Shanghai',
				dateStyle: 'short',
				timeStyle: 'medium',
				hour12: false
			}).format(date);
}
export const aiConfigFields = {
	name: '服务名称',
	baseUrl: 'API 地址',
	model: '模型名称',
	apiKey: 'API Key',
	timeoutMs: '请求超时',
	maxSourceChars: '网页正文上限',
	systemPrompt: '系统提示词'
} as const;
