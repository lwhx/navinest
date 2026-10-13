import type { Database } from '$lib/server/db';
import { exportSiteBackup, type SiteBackup } from '$lib/server/services/site-backup';

export const BACKUP_PREFIX = 'backups/';
export const DEFAULT_BACKUP_RETENTION = 14;

/** Minimal R2 surface used for scheduled backups, so the job stays easy to test. */
export type BackupBucket = {
	put(
		key: string,
		value: string,
		options?: { httpMetadata?: { contentType?: string } }
	): Promise<unknown>;
	list(options?: {
		prefix?: string;
		limit?: number;
	}): Promise<{ objects: Array<{ key: string; uploaded?: Date | string; size?: number }> }>;
	delete(key: string): Promise<unknown>;
	get?(key: string): Promise<{ text(): Promise<string> } | null>;
};

export type BackupObject = { key: string; uploadedAt: string | null; size: number | null };

export function backupKey(date: Date) {
	return `${BACKUP_PREFIX}navinest-${date.toISOString().slice(0, 10)}.json`;
}

/** Dated keys sort chronologically, so the newest snapshots are the last ones alphabetically. */
export async function pruneScheduledBackups(bucket: BackupBucket, keep: number) {
	const listed = await bucket.list({ prefix: BACKUP_PREFIX, limit: 1000 });
	const stale = listed.objects
		.map((object) => object.key)
		.filter((key) => key.startsWith(BACKUP_PREFIX) && key.endsWith('.json'))
		.sort()
		.reverse()
		.slice(Math.max(1, Math.trunc(keep)));
	for (const key of stale) await bucket.delete(key);
	return stale;
}

export async function runScheduledBackup(
	bucket: BackupBucket | undefined,
	database: Database,
	options: {
		now?: Date;
		keep?: number;
		/** Manual snapshots have independent names and retention. */
		manualRunId?: number;
		exporter?: (db: Database, now?: Date) => Promise<SiteBackup>;
	} = {}
) {
	if (!bucket) throw new Error('未配置备份存储（R2 绑定 FILES）。');
	const now = options.now ?? new Date();
	const snapshot = await (options.exporter ?? exportSiteBackup)(database, now);
	const manual = options.manualRunId !== undefined;
	const key = manual
		? `manual-backups/navinest-${now.toISOString().replace(/[:.]/g, '-')}-${options.manualRunId}.json`
		: backupKey(now);
	const body = JSON.stringify(snapshot);
	await bucket.put(key, body, {
		httpMetadata: { contentType: 'application/json; charset=utf-8' }
	});
	const pruned = manual
		? await pruneManualBackups(bucket)
		: await pruneScheduledBackups(bucket, options.keep ?? DEFAULT_BACKUP_RETENTION);
	return {
		key,
		bytes: new TextEncoder().encode(body).byteLength,
		generatedAt: snapshot.generatedAt ?? null,
		pruned
	};
}

export async function listScheduledBackups(
	bucket: BackupBucket | undefined,
	limit = 30
): Promise<BackupObject[]> {
	if (!bucket) return [];
	const listings = await Promise.all([
		bucket.list({ prefix: BACKUP_PREFIX, limit: 1000 }),
		bucket.list({ prefix: 'manual-backups/', limit: 1000 })
	]);
	const listed = { objects: listings.flatMap((listing) => listing.objects) };
	return listed.objects
		.filter((object) => isBackupKey(object.key))
		.map((object) => ({
			key: object.key,
			uploadedAt:
				object.uploaded instanceof Date ? object.uploaded.toISOString() : (object.uploaded ?? null),
			size: object.size ?? null
		}))
		.sort((a, b) => backupSortTime(b) - backupSortTime(a) || b.key.localeCompare(a.key))
		.slice(0, Math.max(1, Math.min(100, limit)));
}

export async function readScheduledBackup(bucket: BackupBucket | undefined, key: string) {
	if (!bucket?.get || !isBackupKey(key)) return null;
	const object = await bucket.get(key);
	return object ? object.text() : null;
}

export function isBackupKey(key: string) {
	return (
		(key.startsWith(BACKUP_PREFIX) || key.startsWith('manual-backups/')) && key.endsWith('.json')
	);
}

async function pruneManualBackups(bucket: BackupBucket) {
	const listed = await bucket.list({ prefix: 'manual-backups/', limit: 1000 });
	const stale = listed.objects
		.map((object) => object.key)
		.filter((key) => key.startsWith('manual-backups/') && key.endsWith('.json'))
		.sort()
		.reverse()
		.slice(DEFAULT_BACKUP_RETENTION);
	for (const key of stale) await bucket.delete(key);
	return stale;
}

function backupSortTime(object: BackupObject) {
	const uploaded = object.uploadedAt ? Date.parse(object.uploadedAt) : NaN;
	if (Number.isFinite(uploaded)) return uploaded;
	const manual =
		/^manual-backups\/navinest-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/.exec(
			object.key
		);
	if (manual)
		return Date.parse(`${manual[1]}T${manual[2]}:${manual[3]}:${manual[4]}.${manual[5]}Z`);
	const daily = /^backups\/navinest-(\d{4}-\d{2}-\d{2})\.json$/.exec(object.key);
	return daily ? Date.parse(`${daily[1]}T19:00:00Z`) : 0;
}
