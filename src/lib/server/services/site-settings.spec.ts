import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	loadSiteSettings,
	normalizeSiteSettings,
	readSiteSettings,
	readSiteSettingsWorkspace,
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
	it('preserves unknown extension settings and unrelated rows', async () => {
		const { db, sqlite } = fixture();
		sqlite
			.prepare('INSERT INTO settings(key,value_json) VALUES(?,?)')
			.run('site', JSON.stringify({ ...SITE_SETTINGS_DEFAULTS, extension: { kept: true } }));
		sqlite
			.prepare('INSERT INTO settings(key,value_json) VALUES(?,?)')
			.run('other', '{"secret":"untouched"}');
		const current = await readSiteSettingsWorkspace(db);
		const saved = await saveSiteSettings(
			db,
			{ ...current.settings, siteName: '新名称' },
			current.revision
		);
		expect(saved.revision).not.toBe(current.revision);
		expect(await readSiteSettingsWorkspace(db)).toEqual(saved);
		const raw = sqlite.prepare("SELECT value_json FROM settings WHERE key='site'").get() as {
			value_json: string;
		};
		expect(JSON.parse(raw.value_json)).toMatchObject({
			siteName: '新名称',
			extension: { kept: true }
		});
		expect(sqlite.prepare("SELECT value_json FROM settings WHERE key='other'").get()).toEqual({
			value_json: '{"secret":"untouched"}'
		});
	});

	it('rejects stale first-save and existing-row versions without overwriting', async () => {
		const { db } = fixture();
		const empty = await readSiteSettingsWorkspace(db);
		const first = await saveSiteSettings(
			db,
			{ ...empty.settings, siteName: '先保存' },
			empty.revision
		);
		await expect(
			saveSiteSettings(db, { ...empty.settings, siteName: '旧页面' }, empty.revision)
		).rejects.toMatchObject({ status: 409 });
		const second = await saveSiteSettings(
			db,
			{ ...first.settings, submissionsOpen: false },
			first.revision
		);
		await expect(saveSiteSettings(db, first.settings, first.revision)).rejects.toMatchObject({
			status: 409
		});
		expect(await readSiteSettingsWorkspace(db)).toEqual(second);
	});

	it.each(['not-json', 'null', '[]', '42'])(
		'blocks administrator overwrite of malformed configuration: %s',
		async (raw) => {
			const { db, sqlite } = fixture();
			sqlite.prepare("INSERT INTO settings(key,value_json) VALUES('site',?)").run(raw);
			await expect(readSiteSettingsWorkspace(db)).rejects.toMatchObject({ status: 409 });
			await expect(saveSiteSettings(db, SITE_SETTINGS_DEFAULTS)).rejects.toMatchObject({
				status: 409
			});
			expect(
				(
					sqlite.prepare("SELECT value_json FROM settings WHERE key='site'").get() as {
						value_json: string;
					}
				).value_json
			).toBe(raw);
		}
	);

	it('rejects a writer arriving after the version read inside the final SQL', async () => {
		const { db, sqlite } = fixture();
		await saveSiteSettings(db, SITE_SETTINGS_DEFAULTS);
		const current = await readSiteSettingsWorkspace(db);
		const wrapped: Database = {
			prepare(query) {
				if (query.startsWith('UPDATE settings SET'))
					sqlite
						.prepare("UPDATE settings SET value_json=? WHERE key='site'")
						.run(JSON.stringify({ ...SITE_SETTINGS_DEFAULTS, siteName: '迟到的修改' }));
				return db.prepare(query);
			}
		};
		await expect(
			saveSiteSettings(wrapped, { ...current.settings, siteName: '旧修改' }, current.revision)
		).rejects.toMatchObject({ status: 409 });
		expect((await readSiteSettings(db)).siteName).toBe('迟到的修改');
	});

	it('leaves the original row unchanged when the database aborts the update', async () => {
		const { db, sqlite } = fixture();
		await saveSiteSettings(db, SITE_SETTINGS_DEFAULTS);
		const current = await readSiteSettingsWorkspace(db);
		sqlite.exec(
			"CREATE TRIGGER stop_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT,'forced failure'); END;"
		);
		await expect(
			saveSiteSettings(db, { ...current.settings, siteName: '不可写入' }, current.revision)
		).rejects.toThrow('forced failure');
		expect(await readSiteSettingsWorkspace(db)).toEqual(current);
	});
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
	it.each([
		'//example.com/path',
		'/\\example.com/path',
		'/\nexample.com',
		'http://127.0.0.1/',
		'https://user:pass@example.com/'
	])('rejects unsafe links in both saves and historical public output: %s', (announcementLink) => {
		expect(validateSiteSettingsInput({ siteName: '测试', announcementLink })).toMatchObject({
			valid: false,
			errors: { announcementLink: expect.any(String) }
		});
		expect(normalizeSiteSettings({ announcementLink }).announcementLink).toBe('');
	});
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
