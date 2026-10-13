import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { claimTaskRun, finishTaskRun, loadTaskMonitor, releaseInterruptedTask } from './task-runs';
import { actions, load } from '../../../routes/admin/cron-runs/+page.server';
import {
	runScheduledJob,
	BACKUP_CRON,
	HOTNEWS_CRON,
	MAINTENANCE_CRON,
	SCHEDULER_CRON
} from './scheduled-jobs';
import { TASKS, nextTaskTime, taskTime, taskDuration } from '$lib/task-monitor';
import type { BackupBucket } from './scheduled-backup';
import { listScheduledBackups, readScheduledBackup, runScheduledBackup } from './scheduled-backup';
import type { SiteBackup } from './site-backup';
import { runMaintenance } from './maintenance';
const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	for (const migration of [
		'0001_initial',
		'0002_auth_sessions',
		'0008_cron_health',
		'0011_ai_providers',
		'0012_hot_board_customization',
		'0013_hot_source_refresh_lease',
		'0016_ai_usage_reservations'
	])
		sqlite.exec(readFileSync(`migrations/${migration}.sql`, 'utf8'));
	sqlite.exec(
		"INSERT INTO users(id,username,role,status,display_name) VALUES(1,'admin','admin','active','测试管理员'),(2,'user','user','active','普通用户')"
	);
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
afterEach(() => connections.splice(0).forEach((db) => db.close()));
const actor = { id: 1, displayName: '测试管理员' };
const manual = (requestKey = 'manual-request-key-123') => ({
	trigger: 'manual' as const,
	requestKey,
	actor
});
function bucketFixture() {
	const store = new Map<string, string>();
	const deleted: string[] = [];
	const bucket: BackupBucket = {
		async put(key, body) {
			store.set(key, body);
		},
		async list(options) {
			return {
				objects: [...store.keys()]
					.filter((key) => key.startsWith(options?.prefix ?? ''))
					.map((key) => ({ key }))
			};
		},
		async delete(key) {
			deleted.push(key);
			store.delete(key);
		},
		async get(key) {
			return store.has(key) ? { text: async () => store.get(key)! } : null;
		}
	};
	return { bucket, store, deleted };
}
const exporter = async (_db: Database, now?: Date) =>
	({ generatedAt: now?.toISOString() }) as SiteBackup;
function event(db: Database, form: FormData, admin: unknown = actor, bucket?: BackupBucket) {
	return {
		locals: { admin },
		platform: { env: { DB: db, FILES: bucket } },
		request: new Request('https://nss.whks.de/admin/cron-runs?/run', { method: 'POST', body: form })
	} as unknown as Parameters<NonNullable<typeof actions.run>>[0];
}
function runForm(task = 'hotnews', requestKey = 'manual-route-key-123') {
	const form = new FormData();
	form.set('task', task);
	form.set('requestKey', requestKey);
	return form;
}
describe('unified task records and duplicate protection', () => {
	it('claims only one concurrent run and replays cannot rerun a completed scheduled slot', async () => {
		const { db, sqlite } = fixture();
		const time = Date.parse('2026-10-13T19:00:00Z');
		const ids = await Promise.all([
			claimTaskRun(db, 'backup', time, { trigger: 'scheduled' }),
			claimTaskRun(db, 'backup', time, { trigger: 'scheduled' })
		]);
		expect(ids.filter((id) => id !== null)).toHaveLength(1);
		const id = ids.find((id) => id !== null)!;
		await finishTaskRun(db, id, { status: 'success', summary: 'done' }, 15);
		expect(await claimTaskRun(db, 'backup', time, { trigger: 'scheduled' })).toBeNull();
		expect(
			await claimTaskRun(db, 'backup', time + 86400000, { trigger: 'scheduled' })
		).not.toBeNull();
		expect(sqlite.prepare('SELECT COUNT(*) count FROM cron_runs').get()).toEqual({ count: 2 });
	});
	it('shares running protection between manual and scheduled triggers and scopes it by task', async () => {
		const { db } = fixture();
		const time = Date.now();
		const id = await claimTaskRun(db, 'hotnews', time, manual());
		expect(await claimTaskRun(db, 'hotnews', time, { trigger: 'scheduled' })).toBeNull();
		expect(await claimTaskRun(db, 'maintenance', time, { trigger: 'scheduled' })).not.toBeNull();
		await finishTaskRun(db, id!, { status: 'failed', summary: 'failed' }, 3, 'source down');
		expect(await claimTaskRun(db, 'hotnews', time + 5000, manual())).toBeNull();
		expect(
			await claimTaskRun(db, 'hotnews', time + 5000, manual('another-manual-key-123'))
		).not.toBeNull();
	});
	it('keeps legacy scheduled history idempotent and does not claim unknown ticks', async () => {
		const { db, sqlite } = fixture();
		const time = Date.parse('2026-10-13T01:15:00Z');
		sqlite
			.prepare('INSERT INTO cron_runs(cron,scheduled_at,status) VALUES(?,?,?)')
			.run(HOTNEWS_CRON, new Date(time).toISOString(), 'success');
		expect(await runScheduledJob(db, SCHEDULER_CRON, time)).toEqual({
			job: 'skipped',
			task: 'hotnews'
		});
		expect(await runScheduledJob(db, '0 0 * * *', time)).toMatchObject({ job: 'unknown' });
		expect(sqlite.prepare('SELECT COUNT(*) count FROM cron_runs').get()).toEqual({ count: 1 });
	});
	it('stores successful backup and maintenance outcomes as well as failures and alerts', async () => {
		const { db, sqlite } = fixture();
		const { bucket } = bucketFixture();
		const time = Date.now();
		await runScheduledJob(db, BACKUP_CRON, time, { bucket, exporter });
		await runScheduledJob(db, MAINTENANCE_CRON, time);
		await expect(runScheduledJob(db, BACKUP_CRON, time + 86400000)).rejects.toThrow(
			'未配置备份存储'
		);
		const monitor = await loadTaskMonitor(db);
		expect(monitor.runs.map((run) => run.status)).toEqual(['failed', 'success', 'success']);
		expect(monitor.runs[0].error).toContain('未配置备份存储');
		expect(monitor.runs[1].summary).toContain('过期会话');
		expect(monitor.runs[2].summary).toContain('backups/navinest-');
		expect(monitor.runs.every((run) => run.durationMs !== null && run.finishedAt)).toBe(true);
		expect(sqlite.prepare("SELECT title FROM messages WHERE type='cron_alert'").all()).toEqual([
			{ title: '定时备份失败' }
		]);
	});
	it('does not auto-release stale runs, requires explicit release and fences late completion', async () => {
		const { db, sqlite } = fixture();
		const time = Date.now();
		const id = await claimTaskRun(db, 'backup', time, manual());
		expect(await releaseInterruptedTask(db, id!, actor)).toBe(false);
		sqlite
			.prepare("UPDATE cron_runs SET started_at=datetime('now','-45 minutes') WHERE id=?")
			.run(id!);
		expect(
			(await loadTaskMonitor(db)).jobs.find((job) => job.id === 'backup')?.active?.status
		).toBe('interrupted');
		expect(
			await claimTaskRun(db, 'backup', time + 60000, manual('new-manual-request-123'))
		).toBeNull();
		expect(await releaseInterruptedTask(db, id!, actor)).toBe(true);
		await finishTaskRun(db, id!, { status: 'success', summary: 'late write' }, 10);
		const row = sqlite.prepare('SELECT status,result_json FROM cron_runs WHERE id=?').get(id!) as {
			status: string;
			result_json: string;
		};
		expect(row.status).toBe('failed');
		expect(JSON.parse(row.result_json).releasedBy).toEqual(actor);
		expect(await releaseInterruptedTask(db, id!, actor)).toBe(false);
		expect(
			await claimTaskRun(db, 'backup', time + 60000, manual('new-manual-request-123'))
		).not.toBeNull();
	});
	it('preserves running protection when old history is pruned', async () => {
		const { db, sqlite } = fixture();
		const id = await claimTaskRun(db, 'backup', Date.now(), manual());
		sqlite
			.prepare("UPDATE cron_runs SET started_at=datetime('now','-40 days') WHERE id=?")
			.run(id!);
		await runMaintenance(db);
		expect(sqlite.prepare('SELECT status FROM cron_runs WHERE id=?').get(id!)).toEqual({
			status: 'running'
		});
	});
	it('lists legacy arrays, unknown expressions and malformed records without hiding newer job summaries', async () => {
		const { db, sqlite } = fixture();
		sqlite
			.prepare('INSERT INTO cron_runs(cron,scheduled_at,status,result_json) VALUES(?,?,?,?)')
			.run(
				HOTNEWS_CRON,
				'2026-10-13T01:15:00Z',
				'partial',
				JSON.stringify([{ sourceId: 2, ok: false, error: '<script>alert(1)</script>' }])
			);
		sqlite
			.prepare('INSERT INTO cron_runs(cron,scheduled_at,status,result_json) VALUES(?,?,?,?)')
			.run('old expression', '2026-01-01', 'failed', 'broken');
		const monitor = await loadTaskMonitor(db);
		expect(monitor.runs[0].name).toBe('历史任务');
		expect(monitor.runs[1].sources[0]).toContain('<script>');
		expect((await loadTaskMonitor(db, 'hotnews')).runs).toHaveLength(1);
	});
	it('gets latest and last-success records even when outside the last 50 history rows', async () => {
		const { db, sqlite } = fixture();
		sqlite
			.prepare(
				'INSERT INTO cron_runs(cron,scheduled_at,status,finished_at,started_at) VALUES(?,?,?,?,?)'
			)
			.run(BACKUP_CRON, '2020-01-01', 'success', '2020-01-01 03:00:00', '2020-01-01 00:00:00');
		const insert = sqlite.prepare('INSERT INTO cron_runs(cron,scheduled_at,status) VALUES(?,?,?)');
		for (let i = 0; i < 60; i++) insert.run(HOTNEWS_CRON, String(i), 'success');
		const monitor = await loadTaskMonitor(db);
		expect(monitor.runs).toHaveLength(50);
		expect(monitor.jobs.find((job) => job.id === 'backup')?.lastSuccessAt).toBe(
			'2020-01-01 03:00:00'
		);
	});
});
describe('partial and interrupted failures', () => {
	it('keeps partial hotnews outcomes and reports cache skips honestly', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO hot_sources(id,name,type,url,slug,is_enabled,last_success_at) VALUES(1,'缓存有效源','rss','http://127.0.0.1/cache','cached',1,CURRENT_TIMESTAMP),(2,'失败源','rss','http://127.0.0.1/private','failed',1,NULL)"
		);
		const result = await runScheduledJob(db, HOTNEWS_CRON, Date.now(), { request: manual() });
		expect(result).toMatchObject({
			job: 'hotnews',
			status: 'partial',
			totalSources: 2,
			succeededSources: 1,
			failedSources: 1
		});
		const monitor = await loadTaskMonitor(db);
		expect(monitor.runs[0].status).toBe('partial');
		expect(monitor.runs[0].sources[0]).toContain('缓存有效');
	});
	it('records a maintenance exception and alerts administrators', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec('DROP TABLE user_sessions');
		await expect(runScheduledJob(db, MAINTENANCE_CRON, Date.now())).rejects.toThrow(
			'user_sessions'
		);
		expect((await loadTaskMonitor(db)).runs[0]).toMatchObject({ status: 'failed' });
		expect(sqlite.prepare('SELECT title FROM messages').all()).toEqual([{ title: '系统清理失败' }]);
	});
});
describe('administrator supplement actions', () => {
	it('rejects missing administrators, invalid job names and malformed request identifiers before recording', async () => {
		const { db, sqlite } = fixture();
		expect(await actions.run!(event(db, runForm(), null))).toMatchObject({ status: 403 });
		expect(await actions.run!(event(db, runForm('arbitrary')))).toMatchObject({ status: 400 });
		expect(await actions.run!(event(db, runForm('hotnews', 'short')))).toMatchObject({
			status: 400
		});
		expect(sqlite.prepare('SELECT COUNT(*) count FROM cron_runs').get()).toEqual({ count: 0 });
	});
	it('records the administrator and prevents completed form replay', async () => {
		const { db } = fixture();
		expect(await actions.run!(event(db, runForm()))).toMatchObject({ success: true });
		expect(await actions.run!(event(db, runForm()))).toMatchObject({ status: 409 });
		const monitor = await loadTaskMonitor(db);
		expect(monitor.runs[0]).toMatchObject({
			trigger: 'manual',
			actor: '测试管理员',
			status: 'success'
		});
	});
	it('reports a failed backup action and leaves a retryable failed record', async () => {
		const { db } = fixture();
		expect(await actions.run!(event(db, runForm('backup')))).toMatchObject({ status: 500 });
		expect((await loadTaskMonitor(db)).runs[0]).toMatchObject({
			status: 'failed',
			trigger: 'manual'
		});
	});
	it('requires an explicit interruption confirmation', async () => {
		const { db } = fixture();
		const form = new FormData();
		form.set('id', '1');
		expect(await actions.release!(event(db, form))).toMatchObject({ status: 400 });
	});
	it('degrades clearly when the binding is absent and exposes only URL whitelisted filtering', async () => {
		const value = await load!({
			url: new URL('https://nss.whks.de/admin/cron-runs?task=unsafe'),
			platform: undefined
		} as Parameters<NonNullable<typeof load>>[0]);
		expect(value).toMatchObject({ available: false, filter: 'all', runs: [] });
	});
});
describe('independent manual backup retention', () => {
	it('does not overwrite or prune daily backups and manual snapshots can be listed and downloaded', async () => {
		const { db } = fixture();
		const { bucket, store } = bucketFixture();
		for (let i = 1; i <= 16; i++)
			store.set(`backups/navinest-2026-09-${String(i).padStart(2, '0')}.json`, 'daily');
		for (let i = 1; i <= 16; i++)
			await runScheduledBackup(bucket, db, {
				now: new Date(`2026-10-${String(i).padStart(2, '0')}T04:00:00Z`),
				manualRunId: i,
				exporter
			});
		expect([...store.keys()].filter((key) => key.startsWith('backups/'))).toHaveLength(16);
		expect([...store.keys()].filter((key) => key.startsWith('manual-backups/'))).toHaveLength(14);
		const list = await listScheduledBackups(bucket);
		expect(list[0].key).toContain('manual-backups/navinest-2026-10-16');
		expect(JSON.parse((await readScheduledBackup(bucket, list[0].key))!)).toMatchObject({
			generatedAt: '2026-10-16T04:00:00.000Z'
		});
	});
});
describe('task display time', () => {
	it('uses Beijing time for SQLite UTC timestamps and computes next slots across year boundaries', () => {
		expect(taskTime('2026-10-13 19:00:00')).toContain('2026/10/14 03:00:00');
		expect(nextTaskTime(TASKS[1], new Date('2026-12-31T19:00:00Z'))).toBe(
			'2027-01-01T19:00:00.000Z'
		);
		expect(taskDuration(2000)).toBe('2.0 秒');
	});
});
