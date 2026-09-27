import { describe, expect, it } from 'vitest';
import type { Database } from '$lib/server/db';
import {
	BACKUP_PREFIX,
	backupKey,
	listScheduledBackups,
	pruneScheduledBackups,
	readScheduledBackup,
	runScheduledBackup,
	type BackupBucket
} from '$lib/server/services/scheduled-backup';
import type { SiteBackup } from '$lib/server/services/site-backup';

type Entry = { body: string; uploaded: Date; size: number };

function fakeBucket(seed: Record<string, string> = {}) {
	const store = new Map<string, Entry>();
	for (const [key, body] of Object.entries(seed))
		store.set(key, { body, uploaded: new Date('2026-09-01T00:00:00Z'), size: body.length });
	const deleted: string[] = [];
	const puts: Array<{ key: string; contentType?: string; body: string }> = [];
	const bucket: BackupBucket = {
		async put(key, value, options) {
			puts.push({ key, contentType: options?.httpMetadata?.contentType, body: value });
			store.set(key, {
				body: value,
				uploaded: new Date('2026-09-27T19:00:00Z'),
				size: value.length
			});
			return null;
		},
		async list(options) {
			const prefix = options?.prefix ?? '';
			return {
				objects: [...store.entries()]
					.filter(([key]) => key.startsWith(prefix))
					.map(([key, entry]) => ({ key, uploaded: entry.uploaded, size: entry.size }))
			};
		},
		async delete(key) {
			deleted.push(key);
			store.delete(key);
			return null;
		},
		async get(key) {
			const entry = store.get(key);
			return entry ? { text: async () => entry.body } : null;
		}
	};
	return { bucket, store, deleted, puts };
}

const exporter = (async () =>
	({ generatedAt: '2026-09-27T19:00:00.000Z' }) as unknown as SiteBackup) as (
	db: Database,
	now?: Date
) => Promise<SiteBackup>;

describe('scheduled backups', () => {
	it('names snapshots by UTC date', () => {
		expect(backupKey(new Date('2026-09-27T19:00:00Z'))).toBe(
			`${BACKUP_PREFIX}navinest-2026-09-27.json`
		);
	});

	it('stores a dated snapshot and prunes everything past the retention window', async () => {
		const seed: Record<string, string> = {};
		for (let day = 1; day <= 16; day += 1)
			seed[`${BACKUP_PREFIX}navinest-2026-09-${String(day).padStart(2, '0')}.json`] =
				`{"day":${day}}`;
		const { bucket, deleted, puts } = fakeBucket(seed);
		const result = await runScheduledBackup(bucket, {} as Database, {
			now: new Date('2026-09-27T19:00:00Z'),
			keep: 14,
			exporter
		});
		expect(result.key).toBe(`${BACKUP_PREFIX}navinest-2026-09-27.json`);
		expect(result.generatedAt).toBe('2026-09-27T19:00:00.000Z');
		expect(result.bytes).toBeGreaterThan(0);
		expect(deleted).toEqual([
			`${BACKUP_PREFIX}navinest-2026-09-03.json`,
			`${BACKUP_PREFIX}navinest-2026-09-02.json`,
			`${BACKUP_PREFIX}navinest-2026-09-01.json`
		]);
		expect(result.pruned).toHaveLength(3);
		expect(puts[0]).toMatchObject({
			key: `${BACKUP_PREFIX}navinest-2026-09-27.json`,
			contentType: 'application/json; charset=utf-8'
		});
		expect(JSON.parse(puts[0].body)).toMatchObject({ generatedAt: '2026-09-27T19:00:00.000Z' });
	});

	it('keeps the newest snapshot when retention is one', async () => {
		const { bucket, deleted } = fakeBucket({
			[`${BACKUP_PREFIX}navinest-2026-09-26.json`]: '{}',
			[`${BACKUP_PREFIX}navinest-2026-09-25.json`]: '{}'
		});
		await runScheduledBackup(bucket, {} as Database, {
			now: new Date('2026-09-27T19:00:00Z'),
			keep: 1,
			exporter
		});
		expect(deleted).toEqual([
			`${BACKUP_PREFIX}navinest-2026-09-26.json`,
			`${BACKUP_PREFIX}navinest-2026-09-25.json`
		]);
	});

	it('refuses to run without a bucket', async () => {
		await expect(runScheduledBackup(undefined, {} as Database, { exporter })).rejects.toThrow(
			'未配置备份存储'
		);
	});

	it('lists stored snapshots newest first and ignores unrelated objects', async () => {
		const { bucket } = fakeBucket({
			[`${BACKUP_PREFIX}navinest-2026-09-25.json`]: '{}',
			[`${BACKUP_PREFIX}navinest-2026-09-27.json`]: '{"a":1}',
			[`${BACKUP_PREFIX}notes.txt`]: 'ignore me',
			'uploads/logo.png': 'nope'
		});
		const listed = await listScheduledBackups(bucket);
		expect(listed.map((entry) => entry.key)).toEqual([
			`${BACKUP_PREFIX}navinest-2026-09-27.json`,
			`${BACKUP_PREFIX}navinest-2026-09-25.json`
		]);
		expect(listed[0]).toMatchObject({
			size: '{"a":1}'.length,
			uploadedAt: '2026-09-01T00:00:00.000Z'
		});
		expect(await listScheduledBackups(bucket, 1)).toHaveLength(1);
		expect(await listScheduledBackups(undefined)).toEqual([]);
	});

	it('reads a stored snapshot and rejects keys outside the backup prefix', async () => {
		const { bucket } = fakeBucket({ [`${BACKUP_PREFIX}navinest-2026-09-27.json`]: '{"ok":true}' });
		expect(await readScheduledBackup(bucket, `${BACKUP_PREFIX}navinest-2026-09-27.json`)).toBe(
			'{"ok":true}'
		);
		expect(await readScheduledBackup(bucket, 'uploads/logo.png')).toBeNull();
		expect(await readScheduledBackup(bucket, `${BACKUP_PREFIX}navinest-2026-09-27.txt`)).toBeNull();
		expect(await readScheduledBackup(undefined, `${BACKUP_PREFIX}x.json`)).toBeNull();
	});

	it('prunes only dated snapshots and never the whole bucket', async () => {
		const { bucket, deleted } = fakeBucket({
			[`${BACKUP_PREFIX}navinest-2026-09-27.json`]: '{}',
			[`${BACKUP_PREFIX}navinest-2026-09-26.json`]: '{}',
			[`${BACKUP_PREFIX}readme.md`]: 'docs'
		});
		expect(await pruneScheduledBackups(bucket, 1)).toEqual([
			`${BACKUP_PREFIX}navinest-2026-09-26.json`
		]);
		expect(deleted).toHaveLength(1);
	});
});
