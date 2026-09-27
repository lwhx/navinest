import type { Database } from '$lib/server/db';
import { SITE_SETTINGS_DEFAULTS, SITE_SETTINGS_KEY, type SiteSettings } from '$lib/types/site';
import { validateExternalTarget } from '$lib/server/safe-target';
import type { ValidationResult } from '$lib/server/admin-validation';

export { SITE_SETTINGS_DEFAULTS, SITE_SETTINGS_KEY, siteDisplayName } from '$lib/types/site';
export type { SiteSettings } from '$lib/types/site';

function text(value: unknown, fallback: string, limit: number) {
	return typeof value === 'string' ? value.trim().slice(0, limit) : fallback;
}

function flag(value: unknown, fallback: boolean) {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string')
		return value === 'on' || value === 'true' || value === '1'
			? true
			: value === ''
				? fallback
				: false;
	return fallback;
}

/** Tolerates hand-edited or partially written rows so public pages never break. */
export function normalizeSiteSettings(value: unknown): SiteSettings {
	const record =
		value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	return {
		siteName:
			text(record.siteName, SITE_SETTINGS_DEFAULTS.siteName, 40) || SITE_SETTINGS_DEFAULTS.siteName,
		siteTagline: text(record.siteTagline, SITE_SETTINGS_DEFAULTS.siteTagline, 60),
		siteDescription: text(record.siteDescription, SITE_SETTINGS_DEFAULTS.siteDescription, 200),
		announcementEnabled: flag(
			record.announcementEnabled,
			SITE_SETTINGS_DEFAULTS.announcementEnabled
		),
		announcementMessage: text(record.announcementMessage, '', 240),
		announcementLink: text(record.announcementLink, '', 300),
		announcementLinkLabel: text(record.announcementLinkLabel, '', 40),
		submissionsOpen: flag(record.submissionsOpen, SITE_SETTINGS_DEFAULTS.submissionsOpen),
		sitemapEnabled: flag(record.sitemapEnabled, SITE_SETTINGS_DEFAULTS.sitemapEnabled),
		robotsExtra: typeof record.robotsExtra === 'string' ? record.robotsExtra.slice(0, 500) : ''
	};
}

export function validateSiteSettingsInput(
	input: Record<string, unknown>
): ValidationResult<SiteSettings> {
	const errors: Record<string, string> = {};
	const siteName = typeof input.siteName === 'string' ? input.siteName.trim() : '';
	if (!siteName) errors.siteName = '站点名称不能为空。';
	else if (siteName.length > 40) errors.siteName = '站点名称不能超过 40 个字符。';

	const siteTagline = typeof input.siteTagline === 'string' ? input.siteTagline.trim() : '';
	if (siteTagline.length > 60) errors.siteTagline = '站点副标题不能超过 60 个字符。';

	const siteDescription =
		typeof input.siteDescription === 'string' ? input.siteDescription.trim() : '';
	if (siteDescription.length > 200) errors.siteDescription = '站点描述不能超过 200 个字符。';

	const announcementEnabled = flag(input.announcementEnabled, false);
	const announcementMessage =
		typeof input.announcementMessage === 'string' ? input.announcementMessage.trim() : '';
	if (announcementMessage.length > 240)
		errors.announcementMessage = '公告内容不能超过 240 个字符。';
	else if (announcementEnabled && !announcementMessage)
		errors.announcementMessage = '开启公告条后必须填写公告内容。';

	const rawLink = typeof input.announcementLink === 'string' ? input.announcementLink.trim() : '';
	let announcementLink = '';
	if (rawLink) {
		if (rawLink.length > 300) errors.announcementLink = '公告链接不能超过 300 个字符。';
		else if (rawLink.startsWith('/')) announcementLink = rawLink;
		else {
			const target = validateExternalTarget(rawLink);
			if (!target.valid) errors.announcementLink = '公告链接需要是站内路径或合法的 http(s) 地址。';
			else announcementLink = target.target;
		}
	}

	const announcementLinkLabel =
		typeof input.announcementLinkLabel === 'string' ? input.announcementLinkLabel.trim() : '';
	if (announcementLinkLabel.length > 40)
		errors.announcementLinkLabel = '链接文字不能超过 40 个字符。';

	const robotsExtra = typeof input.robotsExtra === 'string' ? input.robotsExtra.trim() : '';
	if (robotsExtra.length > 500) errors.robotsExtra = 'robots 附加规则不能超过 500 个字符。';

	return Object.keys(errors).length
		? { valid: false as const, errors }
		: {
				valid: true as const,
				data: {
					siteName,
					siteTagline,
					siteDescription,
					announcementEnabled,
					announcementMessage,
					announcementLink,
					announcementLinkLabel,
					submissionsOpen: flag(input.submissionsOpen, false),
					sitemapEnabled: flag(input.sitemapEnabled, false),
					robotsExtra
				}
			};
}

export async function readSiteSettings(database: Database): Promise<SiteSettings> {
	const row = (
		await database
			.prepare('SELECT value_json FROM settings WHERE key=? LIMIT 1')
			.bind(SITE_SETTINGS_KEY)
			.all<{ value_json: string }>()
	).results[0];
	if (!row) return { ...SITE_SETTINGS_DEFAULTS };
	return normalizeSiteSettings(JSON.parse(row.value_json));
}

/** Public-page helper: never throws, falls back to code defaults. */
export async function loadSiteSettings(database: Database | null): Promise<SiteSettings> {
	if (!database) return { ...SITE_SETTINGS_DEFAULTS };
	try {
		return await readSiteSettings(database);
	} catch {
		return { ...SITE_SETTINGS_DEFAULTS };
	}
}

export async function saveSiteSettings(database: Database, settings: SiteSettings) {
	await database
		.prepare(
			`INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
			 ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP`
		)
		.bind(SITE_SETTINGS_KEY, JSON.stringify(settings))
		.all();
}
