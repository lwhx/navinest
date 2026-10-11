import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	readSearchEnginePreference,
	saveSearchEnginePreference,
	SEARCH_ENGINE_STORAGE_KEY
} from '$lib/search-engine-preference';
afterEach(() => vi.unstubAllGlobals());
describe('search engine preference', () => {
	it('restores only an enabled engine key and saves a new choice', () => {
		const values = new Map([[SEARCH_ENGINE_STORAGE_KEY, 'google']]);
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key),
			setItem: (key: string, value: string) => values.set(key, value)
		});
		expect(readSearchEnginePreference(['site', 'google'])).toBe('google');
		saveSearchEnginePreference('site');
		expect(readSearchEnginePreference(['site', 'google'])).toBe('site');
	});
	it('ignores removed/disabled engines and missing storage', () => {
		vi.stubGlobal('localStorage', { getItem: () => 'removed' });
		expect(readSearchEnginePreference(['site', 'google'])).toBeNull();
		vi.stubGlobal('localStorage', undefined);
		expect(readSearchEnginePreference(['site'])).toBeNull();
	});
	it('keeps selection usable when reading or writing storage is blocked', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('full');
			}
		});
		expect(readSearchEnginePreference(['site'])).toBeNull();
		expect(() => saveSearchEnginePreference('google')).not.toThrow();
	});
});
