import { describe, expect, it, vi } from 'vitest';
import { retrySync } from '../../scripts/backup-lib.mjs';
describe('backup command retry', () => {
	it('retries transient read failures and returns the successful result', () => {
		const operation = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error('fetch failed');
			})
			.mockImplementationOnce(() => {
				throw new Error('ETIMEDOUT');
			})
			.mockReturnValue('ok');
		expect(retrySync(operation, { attempts: 3, delayMs: 0 })).toBe('ok');
		expect(operation).toHaveBeenCalledTimes(3);
	});
	it('does not retry non-transient failures', () => {
		const operation = vi.fn(() => {
			throw new Error('invalid command');
		});
		expect(() => retrySync(operation, { attempts: 3, delayMs: 0 })).toThrow('invalid command');
		expect(operation).toHaveBeenCalledTimes(1);
	});
});
