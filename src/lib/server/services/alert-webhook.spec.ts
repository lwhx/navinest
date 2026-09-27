import { describe, expect, it } from 'vitest';
import { buildAlertPayload, sendAlertWebhook } from '$lib/server/services/alert-webhook';

const alert = {
	title: '热榜定时刷新异常',
	content: '1 个热榜源刷新失败，请在后台定时任务页面查看详情。',
	data: { cronRunId: 12, failures: [{ sourceId: 5, error: 'HTTP 500' }] }
};

describe('alert webhook payloads', () => {
	it('uses the generic document for unknown receivers', () => {
		expect(buildAlertPayload('https://hooks.example.com/navinest', alert)).toEqual({
			event: 'navinest.alert',
			title: alert.title,
			content: alert.content,
			data: alert.data
		});
	});
	it('matches the WeCom and DingTalk text payload', () => {
		const expected = { msgtype: 'text', text: { content: `${alert.title}\n${alert.content}` } };
		expect(
			buildAlertPayload('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x', alert)
		).toEqual(expected);
		expect(buildAlertPayload('https://oapi.dingtalk.com/robot/send?access_token=y', alert)).toEqual(
			expected
		);
	});
	it('matches the Feishu and Lark text payload', () => {
		const expected = { msg_type: 'text', content: { text: `${alert.title}\n${alert.content}` } };
		expect(buildAlertPayload('https://open.feishu.cn/open-apis/bot/v2/hook/z', alert)).toEqual(
			expected
		);
		expect(buildAlertPayload('https://open.larksuite.com/open-apis/bot/v2/hook/z', alert)).toEqual(
			expected
		);
	});
});

describe('alert webhook delivery', () => {
	it('posts the payload and reports the status', async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const delivery = await sendAlertWebhook('https://hooks.example.com/a', alert, (async (
			url: RequestInfo | URL,
			init?: RequestInit
		) => {
			calls.push({ url: String(url), init: init ?? {} });
			return new Response('ok', { status: 200 });
		}) as typeof fetch);
		expect(delivery).toEqual({ ok: true, status: 200 });
		expect(calls[0]?.url).toBe('https://hooks.example.com/a');
		expect(calls[0]?.init.method).toBe('POST');
		expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ event: 'navinest.alert' });
		expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
	});
	it('refuses private or malformed targets without fetching', async () => {
		let calls = 0;
		const fetcher = (async () => {
			calls += 1;
			return new Response('ok');
		}) as typeof fetch;
		for (const url of ['http://127.0.0.1/hook', 'http://10.0.0.9/hook', 'not-a-url', '']) {
			const delivery = await sendAlertWebhook(url, alert, fetcher);
			expect(delivery.ok).toBe(false);
			expect(delivery.error).toContain('告警地址无效');
		}
		expect(calls).toBe(0);
	});
	it('reports HTTP failures and network errors instead of throwing', async () => {
		expect(
			await sendAlertWebhook(
				'https://hooks.example.com/a',
				alert,
				(async () => new Response('nope', { status: 503 })) as typeof fetch
			)
		).toEqual({ ok: false, status: 503, error: '告警推送失败：HTTP 503' });
		expect(
			await sendAlertWebhook('https://hooks.example.com/a', alert, (async () => {
				throw new Error('socket closed');
			}) as typeof fetch)
		).toEqual({ ok: false, error: 'socket closed' });
	});
});
