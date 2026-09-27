import { validateExternalTarget } from '$lib/server/safe-target';

export type CronAlert = {
	title: string;
	content: string;
	data: Record<string, unknown>;
};

export type AlertDelivery = { ok: boolean; status?: number; error?: string };

const timeoutMs = 5000;

/**
 * Group-chat webhooks (WeCom, DingTalk, Feishu) expect their own text payload shape,
 * every other receiver gets the generic NaviNest alert document.
 */
export function buildAlertPayload(url: string, alert: CronAlert) {
	let host: string;
	try {
		host = new URL(url).host.toLowerCase();
	} catch {
		host = '';
	}
	const text = `${alert.title}\n${alert.content}`;
	if (host === 'qyapi.weixin.qq.com' || host === 'oapi.dingtalk.com')
		return { msgtype: 'text', text: { content: text } };
	if (host === 'open.feishu.cn' || host === 'open.larksuite.com')
		return { msg_type: 'text', content: { text } };
	return { event: 'navinest.alert', title: alert.title, content: alert.content, data: alert.data };
}

/** Pushes one alert to an external webhook; never throws so cron runs cannot fail because of alerting. */
export async function sendAlertWebhook(
	url: string,
	alert: CronAlert,
	fetcher: typeof fetch = fetch
): Promise<AlertDelivery> {
	const target = validateExternalTarget(url ?? '');
	if (!target.valid) return { ok: false, error: `告警地址无效：${target.reason}` };
	const controller = new AbortController(),
		timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetcher(target.target, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(buildAlertPayload(target.target, alert)),
			signal: controller.signal
		});
		if (!response.ok)
			return { ok: false, status: response.status, error: `告警推送失败：HTTP ${response.status}` };
		return { ok: true, status: response.status };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		};
	} finally {
		clearTimeout(timer);
	}
}
