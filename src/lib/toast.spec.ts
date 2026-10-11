import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('toast feedback', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(async () => {
		const toast = await import('./toast.svelte').catch(() => undefined);
		if (toast) {
			for (const item of [...toast.getToasts()]) toast.removeToast(item.id);
		}
		vi.useRealTimers();
	});

	it('loads the global toast component during server rendering', async () => {
		await expect(import('./components/ToastContainer.svelte')).resolves.toHaveProperty('default');
	});

	it('removes a message after its configured duration', async () => {
		const { showToast, getToasts } = await import('./toast.svelte');
		showToast('已保存', 'success', 1000);
		expect(getToasts()).toHaveLength(1);
		vi.advanceTimersByTime(999);
		expect(getToasts()[0]).toMatchObject({ message: '已保存', type: 'success' });
		vi.advanceTimersByTime(1);
		expect(getToasts()).toHaveLength(0);
	});
	it('keeps errors visible until dismissed unless an explicit duration is provided', async () => {
		const { showToast, getToasts, removeToast } = await import('./toast.svelte');
		const persistent = showToast('保存失败，请重试。', 'error');
		const timed = showToast('临时错误', 'error', 1000);
		vi.advanceTimersByTime(10000);
		expect(getToasts().map((toast) => toast.id)).toEqual([persistent]);
		removeToast(persistent);
		expect(getToasts().some((toast) => toast.id === timed)).toBe(false);
	});

	it('dismisses only the selected toast and leaves persistent messages visible', async () => {
		const { showToast, getToasts, removeToast } = await import('./toast.svelte');
		const first = showToast('第一个提示', 'info', 0);
		const second = showToast('第二个提示', 'error', 0);
		removeToast(first);
		removeToast(first);
		vi.advanceTimersByTime(10000);
		expect(getToasts()).toEqual([{ id: second, message: '第二个提示', type: 'error' }]);
	});
});
