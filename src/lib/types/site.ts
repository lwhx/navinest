import { appConfig } from '$lib/config';

export type SiteSettings = {
	siteName: string;
	siteTagline: string;
	siteDescription: string;
	announcementEnabled: boolean;
	announcementMessage: string;
	announcementLink: string;
	announcementLinkLabel: string;
	submissionsOpen: boolean;
	registrationOpen: boolean;
	sitemapEnabled: boolean;
	robotsExtra: string;
};

export const SITE_SETTINGS_KEY = 'site';

export const SITE_SETTINGS_DEFAULTS: SiteSettings = {
	siteName: appConfig.name,
	siteTagline: '导航巢',
	siteDescription: appConfig.tagline,
	announcementEnabled: false,
	announcementMessage: '',
	announcementLink: '',
	announcementLinkLabel: '',
	submissionsOpen: true,
	registrationOpen: false,
	sitemapEnabled: true,
	robotsExtra: ''
};

export function siteDisplayName(settings: SiteSettings) {
	return [settings.siteName, settings.siteTagline].filter(Boolean).join(' ');
}
