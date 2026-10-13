import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../routes/api/admin/items/enrich/+server';
import { fetchWebSnapshot, WebFetchError } from './services/web-enrichment';
vi.mock('./services/web-enrichment', async (original) => ({
	...(await original<object>()),
	fetchWebSnapshot: vi.fn()
}));
const snapshot = {
	fetchedUrl: 'https://example.com/',
	title: 'Example',
	description: 'Useful site',
	excerpt: '',
	siteName: '',
	iconUrl: '',
	fetchedAt: '2026-10-13T00:00:00Z'
};
function event(admin = true, body: unknown = { url: 'https://example.com', excludeId: 7 }) {
	const bind = vi.fn(() => ({ all: async () => ({ results: [{ id: 8, title: '已收录' }] }) }));
	return {
		bind,
		args: {
			locals: { admin: admin ? { id: 1 } : null },
			platform: { env: { DB: { prepare: () => ({ bind }) } } },
			request: new Request('https://example.org/api/admin/items/enrich', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			})
		} as unknown as Parameters<typeof POST>[0]
	};
}
beforeEach(() => vi.clearAllMocks());
describe('administrator webpage enrichment', () => {
	it('rejects unauthorized access without fetching', async () => {
		const { args } = event(false);
		expect((await POST(args)).status).toBe(403);
		expect(fetchWebSnapshot).not.toHaveBeenCalled();
	});
	it('returns metadata and duplicates excluding the current item', async () => {
		vi.mocked(fetchWebSnapshot).mockResolvedValue(snapshot);
		const { args, bind } = event();
		const response = await POST(args);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			title: 'Example',
			duplicates: [{ id: 8, title: '已收录' }]
		});
		expect(bind).toHaveBeenCalledWith(7, 'https://example.com', 'https://example.com/');
	});
	it('returns safe fetch errors for prohibited or unreachable targets', async () => {
		vi.mocked(fetchWebSnapshot).mockRejectedValue(new WebFetchError('不允许访问内网地址。'));
		const { args } = event();
		const response = await POST(args);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ error: '不允许访问内网地址。' });
	});
	it('rejects missing addresses before fetching', async () => {
		const { args } = event(true, {});
		expect((await POST(args)).status).toBe(400);
		expect(fetchWebSnapshot).not.toHaveBeenCalled();
	});
});
