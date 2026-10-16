export const BACKUP_MAX_BYTES = 2 * 1024 * 1024;
export const backupGroups = {
	categories: '分类',
	tags: '标签',
	items: '内容',
	homeModules: '首页模块',
	searchEngines: '搜索源',
	hotSources: '热榜源',
	settings: '站点配置'
} as const;
export type BackupGroup = keyof typeof backupGroups;
export const backupActions = {
	added: '新增',
	updated: '更新',
	unchanged: '不变',
	removed: '移除',
	preserved: '保留'
} as const;
export type BackupAction = keyof typeof backupActions;
export type BackupChange = {
	group: BackupGroup;
	key: string;
	name: string;
	action: BackupAction;
	fields: string[];
};
export type BackupPreview = {
	backupDigest: string;
	stateDigest: string;
	generatedAt: string | null;
	groups: Array<{
		key: BackupGroup;
		mode: 'merge' | 'replace';
		current: number;
		incoming: number;
		counts: Record<BackupAction, number>;
	}>;
	changes: BackupChange[];
	hasChanges: boolean;
};
export function backupDate(value: string | null | undefined) {
	if (!value) return '时间未知';
	const date = new Date(value);
	return Number.isFinite(date.getTime())
		? new Intl.DateTimeFormat('zh-CN', {
				timeZone: 'Asia/Shanghai',
				dateStyle: 'medium',
				timeStyle: 'medium'
			}).format(date)
		: '时间未知';
}
