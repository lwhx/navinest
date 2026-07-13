export type ContentType = 'site' | 'post' | 'app' | 'book' | 'bulletin';

export type Category = {
	id: number;
	type: ContentType;
	parentId: number | null;
	name: string;
	slug: string;
	icon: string | null;
	description: string | null;
	sortOrder: number;
	isVisible: boolean;
	createdAt: string;
	updatedAt: string;
};

export type Tag = {
	id: number;
	type: ContentType;
	name: string;
	slug: string;
	description: string | null;
	createdAt: string;
	updatedAt: string;
};

export type ItemMeta = {
	id: number;
	itemId: number;
	key: string;
	value: string | null;
};

export type Item = {
	id: number;
	type: ContentType;
	categoryId: number | null;
	authorId: number | null;
	title: string;
	slug: string;
	summary: string | null;
	content: string | null;
	coverFileId: number | null;
	iconFileId: number | null;
	status: string;
	visibility: string;
	sortOrder: number;
	isFeatured: boolean;
	publishedAt: string | null;
	createdAt: string;
	updatedAt: string;
	category: Pick<Category, 'id' | 'name' | 'slug'> | null;
	tags: Array<Pick<Tag, 'name' | 'slug'>>;
	meta: Record<string, string>;
};

export type SearchEngine = {
	id: number;
	groupKey: string;
	name: string;
	key: string;
	urlTemplate: string;
	placeholder: string | null;
	sortOrder: number;
	isEnabled: boolean;
};

export type HomeModule = {
	id: number;
	type: 'search' | 'content' | 'hot' | 'ranking' | 'custom_html' | 'links';
	title: string;
	config: Record<string, unknown>;
	sortOrder: number;
	isEnabled: boolean;
	createdAt: string;
	updatedAt: string;
};
