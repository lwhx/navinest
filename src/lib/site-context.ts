import { getContext, setContext } from 'svelte';
import { SITE_SETTINGS_DEFAULTS, type SiteSettings } from '$lib/types/site';

const SITE_SETTINGS_CONTEXT = Symbol('navinest-site-settings');

export function provideSiteSettings(read: () => SiteSettings) {
	setContext(SITE_SETTINGS_CONTEXT, read);
}

/** Components read live site settings through the root layout; falls back to code defaults. */
export function useSiteSettings(): () => SiteSettings {
	const read = getContext<(() => SiteSettings) | undefined>(SITE_SETTINGS_CONTEXT);
	return read ?? (() => SITE_SETTINGS_DEFAULTS);
}
