export const SEARCH_ENGINE_STORAGE_KEY = 'navinest.search-engine';

export function readSearchEnginePreference(keys: string[]) {
	try {
		const saved = globalThis.localStorage.getItem(SEARCH_ENGINE_STORAGE_KEY);
		return saved && keys.includes(saved) ? saved : null;
	} catch {
		return null;
	}
}

export function saveSearchEnginePreference(key: string) {
	try {
		globalThis.localStorage.setItem(SEARCH_ENGINE_STORAGE_KEY, key);
	} catch {
		// A blocked or full storage must not prevent choosing a search engine.
	}
}
