import type { Database, DatabaseStatement } from '$lib/server/db';
import {
	backupGroups,
	type BackupGroup,
	type BackupPreview,
	type BackupChange
} from '$lib/backup-preview';
import type { SiteBackup } from './site-backup';
import { validateSiteBackup, backupKey } from './site-backup-validation';
import {
	readBackupState,
	portableBackup,
	stableJson,
	backupDigest,
	stateGuards
} from './site-backup-state';
import { backupWrites } from './site-backup-write';
export class BackupRestoreError extends Error {
	constructor(
		message: string,
		public status = 400,
		public details: string[] = [],
		public uncertain = false
	) {
		super(message);
		this.name = 'BackupRestoreError';
	}
}
const fieldNames: Record<string, string> = {
	name: '名称',
	title: '标题',
	parent: '父级分类',
	category: '所属分类',
	icon: '图标',
	description: '说明',
	sortOrder: '排序',
	isVisible: '显示状态',
	summary: '摘要',
	content: '正文',
	status: '发布状态',
	visibility: '可见性',
	isFeatured: '推荐状态',
	publishedAt: '发布时间',
	tags: '标签关系',
	meta: '内容字段',
	type: '类型',
	config: '模块配置',
	groupKey: '分组',
	urlTemplate: '搜索地址',
	placeholder: '提示文字',
	isEnabled: '启用状态',
	url: '来源地址',
	headers: '请求头',
	parser: '解析配置',
	cacheTtl: '缓存时间',
	slug: '标识',
	accentColor: '主题色',
	surfaceColor: '背景色',
	displayLimit: '显示数量',
	layout: '布局',
	showDescription: '显示说明',
	value: '配置值'
};
function normalized<T>(value: T): T {
	if (value && typeof value === 'object' && 'tags' in value && Array.isArray(value.tags))
		return {
			...value,
			tags: [...value.tags].sort((a, b) => backupKey(a).localeCompare(backupKey(b)))
		};
	return value;
}
function records(
	b: SiteBackup,
	key: BackupGroup
): Array<{ key: string; name: string; value: unknown }> {
	if (key === 'settings')
		return Object.entries(b.settings).map(([key, value]) => ({ key, name: key, value: { value } }));
	return b[key].map((row, index) => ({
		key:
			'slug' in row
				? backupKey(row as { type: string; slug: string })
				: 'key' in row
					? String(row.key)
					: key === 'hotSources'
						? String((row as SiteBackup['hotSources'][number]).slug)
						: String(index + 1),
		name: 'title' in row ? String(row.title) : 'name' in row ? String(row.name) : String(index + 1),
		value: normalized(row)
	}));
}
function differences(
	current: SiteBackup,
	incoming: SiteBackup
): Omit<BackupPreview, 'backupDigest' | 'stateDigest' | 'generatedAt'> {
	const changes: BackupChange[] = [],
		groups: BackupPreview['groups'] = [];
	for (const key of Object.keys(backupGroups) as BackupGroup[]) {
		const before = records(current, key),
			after = records(incoming, key),
			byKey = new Map(before.map((r) => [r.key, r]));
		const positions = new Map(before.map((r, i) => [r.key, i]));
		const mode = ['categories', 'tags', 'items'].includes(key) ? 'merge' : 'replace';
		const counts = { added: 0, updated: 0, unchanged: 0, removed: 0, preserved: 0 };
		for (const [index, row] of after.entries()) {
			const prior = byKey.get(row.key);
			byKey.delete(row.key);
			const moved =
				mode === 'replace' && key !== 'settings' && prior && positions.get(row.key) !== index;
			const action = !prior
				? 'added'
				: !moved && stableJson(prior.value) === stableJson(row.value)
					? 'unchanged'
					: 'updated';
			const fields =
				action === 'updated'
					? Object.keys(row.value as object)
							.filter(
								(k) =>
									stableJson((prior!.value as Record<string, unknown>)[k]) !==
									stableJson((row.value as Record<string, unknown>)[k])
							)
							.map((k) => fieldNames[k] ?? '其他配置')
					: [];
			if (moved) fields.push('组内顺序');
			changes.push({ group: key, key: row.key, name: row.name, action, fields });
			counts[action]++;
		}
		for (const row of byKey.values()) {
			const action = mode === 'merge' ? 'preserved' : 'removed';
			changes.push({ group: key, key: row.key, name: row.name, action, fields: [] });
			counts[action]++;
		}
		groups.push({ key, mode, current: before.length, incoming: after.length, counts });
	}
	return {
		changes,
		groups,
		hasChanges: groups.some((g) => g.counts.added + g.counts.updated + g.counts.removed > 0)
	};
}
async function plan(db: Database, input: unknown) {
	const checked = validateSiteBackup(input);
	if (!checked.valid) throw new BackupRestoreError('备份检查未通过。', 422, checked.errors);
	const backup = checked.data,
		state = await readBackupState(db),
		current = portableBackup(state, new Date(), true),
		diff = differences(current, backup);
	const preview: BackupPreview = {
		...diff,
		backupDigest: await backupDigest(backup),
		stateDigest: await backupDigest(state),
		generatedAt: backup.generatedAt ?? null
	};
	const changed = (key: BackupGroup) =>
		new Set(
			diff.changes
				.filter((r) => r.group === key && ['added', 'updated'].includes(r.action))
				.map((r) => r.key)
		);
	const cats = changed('categories'),
		tags = changed('tags'),
		items = changed('items');
	const partial = {
		...backup,
		categories: backup.categories.filter((r) => cats.has(backupKey(r))),
		tags: backup.tags.filter((r) => tags.has(backupKey(r))),
		items: backup.items.filter((r) => items.has(backupKey(r)))
	};
	const replace = new Set(
		diff.groups
			.filter(
				(g) => g.mode === 'replace' && g.counts.added + g.counts.updated + g.counts.removed > 0
			)
			.map((g) => g.key)
	);
	const statements = diff.hasChanges
		? [...stateGuards(db, state), ...backupWrites(db, partial, replace)]
		: [];
	if (statements.length > 38)
		throw new BackupRestoreError('本次恢复规模超出在线单次处理范围，请缩小备份后重新检查。', 422);
	return { preview, statements, backup };
}
export async function previewSiteBackup(db: Database, input: unknown) {
	return (await plan(db, input)).preview;
}
export async function restoreSiteBackup(
	db: Database,
	input: unknown,
	expected?: { backupDigest: string; stateDigest: string }
) {
	const result = await plan(db, input);
	if (
		expected &&
		(expected.backupDigest !== result.preview.backupDigest ||
			expected.stateDigest !== result.preview.stateDigest)
	)
		throw new BackupRestoreError('备份文件或站点内容已变化，请重新检查预览后恢复。', 409);
	if (result.preview.hasChanges) {
		const batch = (db as Database & { batch?: (s: DatabaseStatement[]) => Promise<unknown> }).batch;
		if (!batch) throw new BackupRestoreError('数据库不支持原子恢复。', 503);
		try {
			await batch.call(db, result.statements);
		} catch (error) {
			if (
				String(error).includes('malformed JSON') ||
				String(error).includes('NAVINEST_BACKUP_STATE_CHANGED')
			)
				throw new BackupRestoreError('站点在恢复前发生变化，未执行恢复。请重新检查预览。', 409);
			console.error('Atomic backup restore did not return success', error);
			throw new BackupRestoreError(
				'恢复结果未确认，请重新检查同一文件并核对站点状态。不要直接重复恢复。',
				500,
				[],
				true
			);
		}
	}
	return {
		categories: result.backup.categories.length,
		tags: result.backup.tags.length,
		items: result.backup.items.length,
		changed: result.preview.groups.reduce(
			(n, g) => n + g.counts.added + g.counts.updated + g.counts.removed,
			0
		),
		unchanged: !result.preview.hasChanges
	};
}
