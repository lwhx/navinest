export const BOOKMARK_MAX_BYTES = 2 * 1024 * 1024;
export const BOOKMARK_MAX_ENTRIES = 5000;
export const BOOKMARK_IMPORT_LIMIT = 500;
export const bookmarkStates = {
	new: '可导入',
	existing: '已有书签',
	duplicate: '文件内重复',
	invalid: '无效条目',
	limited: '本次未选（超限）'
} as const;
export type BookmarkRow = {
	id: number;
	title: string;
	url: string;
	folder: string;
	error: string;
	status: keyof typeof bookmarkStates;
	selected: boolean;
};
export type BookmarkMapping = {
	folder: string;
	target: 'none' | 'existing' | 'new' | 'choose';
	categoryId: number | null;
	name: string;
};
export type BookmarkPreview = {
	digest: string;
	generatedAt: string;
	rows: BookmarkRow[];
	mappings: BookmarkMapping[];
	categories: Array<{ id: number; name: string }>;
	selected: number;
	newCategories: string[];
	total: number;
};
export type BookmarkReceipt = {
	digest: string;
	status: 'completed' | 'cancelled';
	imported: number;
	categories: number;
	completedAt: string;
};
