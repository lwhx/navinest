import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	loadSiteSettings,
	normalizeSiteSettings,
	readSiteSettings,
	saveSiteSettings,
	validateSiteSettingsInput
} from '$lib/server/services/site-settings';
import { SITE_SETTINGS_DEFAULTS } from '$lib/types/site';

const connections: DatabaseSync[] = [];

function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
CREATE TABLE settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
	const db: Database = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement: DatabaseStatement = {
				bind(...next) {
					values = next;
					return statement;
				},
				async all<T>() {
					return {
						results: sqlite
							.prepare(query)
							.all(...values.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v))) as T[]
					};
				}
			};
			return statement;
		}
	};
	return { sqlite, db };
}

afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('site settings storage', () => {
	it('falls back to defaults when nothing is stored', async () => {
		const { db } = fixture();
		expect(await readSiteSettings(db)).toEqual(SITE_SETTINGS_DEFAULTS);
		expect(await loadSiteSettings(null)).toEqual(SITE_SETTINGS_DEFAULTS);
	});

	it('round-trips settings and upserts a single row', async () => {
		const { db, sqlite } = fixture();
		const next = {
			...SITE_SETTINGS_DEFAULTS,
			siteName: '安静导航',
			siteTagline: '只放常用入口',
			announcementEnabled: true,
			announcementMessage: '本周维护一次',
			submissionsOpen: false,
			sitemapEnabled: false,
			robotsExtra: 'Disallow: /draft'
		};
		await saveSiteSettings(db, next);
		expect(await readSiteSettings(db)).toEqual(next);
		await saveSiteSettings(db, { ...next, siteName: '安静导航 II' });
		expect(sqlite.prepare('SELECT COUNT(*) count FROM settings').get()).toEqual({ count: 1 });
		expect((await readSiteSettings(db)).siteName).toBe('安静导航 II');
	});

	it('survives hand-edited rows and broken JSON on public pages', async () => {
		const { db, sqlite } = fixture();
		sqlite.prepare("INSERT INTO settings(key,value_json) VALUES('site','not-json')").run();
		expect(await loadSiteSettings(db)).toEqual(SITE_SETTINGS_DEFAULTS);
		await expect(readSiteSettings(db)).rejects.toThrow();

		sqlite
			.prepare("UPDATE settings SET value_json=? WHERE key='site'")
			.run(
				JSON.stringify({ siteName: '  局部设置  ', submissionsOpen: 'false', sitemapEnabled: 'on' })
			);
		const partial = await loadSiteSettings(db);
		expect(partial.siteName).toBe('局部设置');
		expect(partial.submissionsOpen).toBe(false);
		expect(partial.sitemapEnabled).toBe(true);
		expect(partial.siteDescription).toBe(SITE_SETTINGS_DEFAULTS.siteDescription);
	});
});

describe('site settings normalisation', () => {
	it('ignores junk and keeps defaults', () => {
		expect(normalizeSiteSettings(null)).toEqual(SITE_SETTINGS_DEFAULTS);
		expect(normalizeSiteSettings(['nope'])).toEqual(SITE_SETTINGS_DEFAULTS);
		expect(normalizeSiteSettings({ siteName: 42 })).toEqual(SITE_SETTINGS_DEFAULTS);
	});

	it('truncates over-long values instead of throwing', () => {
		const settings = normalizeSiteSettings({
			siteTagline: 'x'.repeat(200),
			robotsExtra: 'y'.repeat(900)
		});
		expect(settings.siteTagline).toHaveLength(60);
		expect(settings.robotsExtra).toHaveLength(500);
	});
});

describe('site settings validation', () => {
	it('normalises a complete submission', () => {
		expect(
			validateSiteSettingsInput({
				siteName: ' NaviNest ',
				siteTagline: ' 导航巢 ',
				siteDescription: ' 安静起点 ',
				announcementEnabled: 'on',
				announcementMessage: ' 维护公告 ',
				announcementLink: '/bulletins/maintenance',
				announcementLinkLabel: ' 查看 ',
				submissionsOpen: 'on',
				registrationOpen: 'on',
				sitemapEnabled: '',
				robotsExtra: 'Disallow: /draft'
			})
		).toEqual({
			valid: true,
			data: {
				siteName: 'NaviNest',
				siteTagline: '导航巢',
				siteDescription: '安静起点',
				announcementEnabled: true,
				announcementMessage: '维护公告',
				announcementLink: '/bulletins/maintenance',
				announcementLinkLabel: '查看',
				submissionsOpen: true,
				registrationOpen: true,
				sitemapEnabled: false,
				robotsExtra: 'Disallow: /draft'
			}
		});
	});

	it('keeps public registration closed unless it is switched on', () => {
		expect(SITE_SETTINGS_DEFAULTS.registrationOpen).toBe(false);
		expect(validateSiteSettingsInput({ siteName: 'NaviNest' })).toMatchObject({
			valid: true,
			data: { registrationOpen: false }
		});
	});

	it('requires a name and a message once the banner is on', () => {
		expect(validateSiteSettingsInput({ siteName: '  ' })).toMatchObject({
			valid: false,
			errors: { siteName: expect.any(String) }
		});
		expect(
			validateSiteSettingsInput({ siteName: 'NaviNest', announcementEnabled: 'on' })
		).toMatchObject({ valid: false, errors: { announcementMessage: expect.any(String) } });
	});

	it('rejects unsafe announcement links and over-long fields', () => {
		expect(
			validateSiteSettingsInput({ siteName: 'NaviNest', announcementLink: 'javascript:alert(1)' })
		).toMatchObject({ valid: false, errors: { announcementLink: expect.any(String) } });
		expect(
			validateSiteSettingsInput({
				siteName: 'NaviNest',
				announcementLink: 'https://example.com/ok'
			})
		).toMatchObject({ valid: true, data: { announcementLink: 'https://example.com/ok' } });
		expect(
			validateSiteSettingsInput({ siteName: 'x'.repeat(41), robotsExtra: 'y'.repeat(501) })
		).toMatchObject({
			valid: false,
			errors: { siteName: expect.any(String), robotsExtra: expect.any(String) }
		});
	});
});
