import type { Database } from '$lib/server/db';

type Ref = { type: string; slug: string };
type Category = Ref & {
	parent: Ref | null;
	name: string;
	icon: string | null;
	description: string | null;
	sortOrder: number;
	isVisible: boolean;
};
type Tag = Ref & { name: string; description: string | null };
type Item = Ref & {
	title: string;
	category: Ref | null;
	summary: string | null;
	content: string | null;
	status: string;
	visibility: string;
	sortOrder: number;
	isFeatured: boolean;
	publishedAt: string | null;
	tags: Ref[];
	meta: Record<string, string | null>;
};
export type SiteBackup = {
	format: 'navinest-backup';
	version: 1;
	generatedAt?: string;
	categories: Category[];
	tags: Tag[];
	items: Item[];
	homeModules: Array<{
		type: string;
		title: string;
		config: Record<string, unknown>;
		sortOrder: number;
		isEnabled: boolean;
	}>;
	searchEngines: Array<{
		groupKey: string;
		name: string;
		key: string;
		urlTemplate: string;
		placeholder: string | null;
		sortOrder: number;
		isEnabled: boolean;
	}>;
	hotSources: Array<{
		name: string;
		type: string;
		url: string;
		headers: Record<string, string>;
		parser: Record<string, string>;
		cacheTtl: number;
		isEnabled: boolean;
		slug?: string;
		description?: string;
		icon?: string;
		accentColor?: string;
		surfaceColor?: string;
		displayLimit?: number;
		layout?: 'list' | 'compact' | 'columns';
		sortOrder?: number;
		showDescription?: boolean;
	}>;
	settings: Record<string, unknown>;
};
export { validateSiteBackup } from './site-backup-validation';
export { previewSiteBackup, restoreSiteBackup, BackupRestoreError } from './site-backup-restore';
import { readBackupState, portableBackup } from './site-backup-state';

export async function exportSiteBackup(db: Database, now = new Date()): Promise<SiteBackup> {
	return portableBackup(await readBackupState(db), now);
}
