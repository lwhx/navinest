import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	validateCategoryInput,
	validateItemInput,
	validateTagInput,
	type CategoryInput,
	type ItemInput,
	type TagInput
} from '$lib/server/admin-validation';
import {
	AdminWriteError,
	requireManagedType,
	createCategory,
	createItem,
	createTag,
	deleteCategory,
	deleteItem,
	deleteTag,
	updateCategory,
	updateItem,
	updateTag
} from '$lib/server/services/admin-write';

const connections: DatabaseSync[] = [];

function createDatabase() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE categories (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
			name TEXT NOT NULL,
			slug TEXT NOT NULL,
			icon TEXT,
			description TEXT,
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_visible INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(type, slug)
		);
		CREATE TABLE tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			name TEXT NOT NULL,
			slug TEXT NOT NULL,
			description TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(type, slug)
		);
		CREATE TABLE items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
			author_id INTEGER,
			title TEXT NOT NULL,
			slug TEXT NOT NULL,
			summary TEXT,
			content TEXT,
			cover_file_id INTEGER,
			icon_file_id INTEGER,
			status TEXT NOT NULL,
			visibility TEXT NOT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_featured INTEGER NOT NULL DEFAULT 0,
			published_at TEXT,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(type, slug)
		);
		CREATE TABLE files (id INTEGER PRIMARY KEY, object_key TEXT, mime_type TEXT);
		CREATE TABLE item_meta (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
			meta_key TEXT NOT NULL,
			meta_value TEXT,
			UNIQUE(item_id, meta_key)
		);
		CREATE TABLE item_tags (
			item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
			tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
			PRIMARY KEY (item_id, tag_id)
		);
	`);

	const database: Database & {
		batch(statements: DatabaseStatement[]): Promise<void>;
	} = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement: DatabaseStatement = {
				bind(...nextValues) {
					values = nextValues;
					return statement;
				},
				async all<T>() {
					const sqliteValues = values.map((value) =>
						value instanceof ArrayBuffer ? new Uint8Array(value) : value
					);
					const rows = sqlite.prepare(query).all(...sqliteValues) as T[];
					return { results: rows };
				}
			};
			return statement;
		},
		async batch(statements) {
			sqlite.exec('BEGIN');
			try {
				for (const statement of statements) await statement.all();
				sqlite.exec('COMMIT');
			} catch (error) {
				sqlite.exec('ROLLBACK');
				throw error;
			}
		}
	};

	return { database, sqlite };
}

function validCategory(input: Record<string, unknown>): CategoryInput {
	const result = validateCategoryInput(input);
	if (!result.valid) throw new Error(JSON.stringify(result.errors));
	return result.data;
}

function validTag(input: Record<string, unknown>): TagInput {
	const result = validateTagInput(input);
	if (!result.valid) throw new Error(JSON.stringify(result.errors));
	return result.data;
}

function validItem(input: Record<string, unknown>): ItemInput {
	const result = validateItemInput(input);
	if (!result.valid) throw new Error(JSON.stringify(result.errors));
	return result.data;
}

afterEach(() => {
	for (const connection of connections.splice(0)) connection.close();
});

describe('administrator write services', () => {
	it.each(['app', 'book', 'bulletin'])(
		'restricts admin creation of %s while preserving existing records',
		async (type) => {
			const { database, sqlite } = createDatabase();
			await expect(requireManagedType(database, 'items', type)).rejects.toMatchObject({
				field: 'type'
			});
			await expect(
				createTag(database, validTag({ type, name: '旧类型', slug: 'old' }))
			).rejects.toMatchObject({ field: 'type' });
			sqlite
				.prepare("INSERT INTO tags(id,type,name,slug) VALUES(30,?,'已有标签','legacy')")
				.run(type);
			await updateTag(database, 30, validTag({ type, name: '保留标签', slug: 'legacy' }));
			expect(sqlite.prepare('SELECT type,name FROM tags WHERE id=30').get()).toEqual({
				type,
				name: '保留标签'
			});
			const id = await createItem(
				database,
				validItem({ type, title: '历史投稿', slug: 'legacy' }),
				null
			);
			await expect(requireManagedType(database, 'items', type, id)).resolves.toBeUndefined();
			await expect(requireManagedType(database, 'items', type, id + 1)).rejects.toMatchObject({
				field: 'type'
			});
		}
	);
	it.each(['app', 'book', 'bulletin'])('rejects new %s categories before writing', async (type) => {
		const { database, sqlite } = createDatabase();
		await expect(
			createCategory(database, validCategory({ type, name: '不再新增', slug: 'retired' }))
		).rejects.toMatchObject({ field: 'type', status: 400 });
		expect(sqlite.prepare('SELECT COUNT(*) AS count FROM categories').get()).toEqual({ count: 0 });
	});
	it.each(['app', 'book', 'bulletin'])(
		'rejects converting a current category to %s',
		async (type) => {
			const { database, sqlite } = createDatabase();
			const id = await createCategory(
				database,
				validCategory({ type: 'site', name: '网址', slug: 'sites' })
			);
			await expect(
				updateCategory(database, id, validCategory({ type, name: '改类型', slug: 'changed' }))
			).rejects.toMatchObject({ field: 'type', status: 400 });
			expect(
				sqlite.prepare('SELECT type, name, slug FROM categories WHERE id = ?').get(id)
			).toEqual({ type: 'site', name: '网址', slug: 'sites' });
		}
	);
	it.each(['app', 'book', 'bulletin'])(
		'allows maintaining a legacy %s category and retains all references',
		async (type) => {
			const { database, sqlite } = createDatabase();
			sqlite
				.prepare("INSERT INTO categories(id,type,name,slug) VALUES(10,?,'旧分类','legacy')")
				.run(type);
			sqlite
				.prepare(
					"INSERT INTO categories(id,type,parent_id,name,slug) VALUES(11,?,10,'旧子分类','child')"
				)
				.run(type);
			const itemId = await createItem(
				database,
				validItem({ type, categoryId: 10, title: '保留内容', slug: 'existing' }),
				null
			);
			await updateCategory(
				database,
				10,
				validCategory({ type, name: '已整理旧分类', slug: 'legacy', isVisible: false })
			);
			expect(
				sqlite.prepare('SELECT type, name, is_visible FROM categories WHERE id = 10').get()
			).toEqual({ type, name: '已整理旧分类', is_visible: 0 });
			expect(sqlite.prepare('SELECT type, parent_id FROM categories WHERE id = 11').get()).toEqual({
				type,
				parent_id: 10
			});
			expect(
				sqlite.prepare('SELECT type, category_id FROM items WHERE id = ?').get(itemId)
			).toEqual({ type, category_id: 10 });
		}
	);
	it('persists, replaces and clears validated content media relations', async () => {
		const { database, sqlite } = createDatabase();
		sqlite.exec(
			"INSERT INTO files VALUES(1,'icon.png','image/png'),(2,'cover.webp','image/webp'),(3,'note.txt','text/plain')"
		);
		const itemId = await createItem(
			database,
			validItem({ type: 'post', title: 'Media', slug: 'media', iconFileId: 1, coverFileId: 2 }),
			null
		);
		expect(
			sqlite.prepare('SELECT icon_file_id,cover_file_id FROM items WHERE id=?').get(itemId)
		).toEqual({ icon_file_id: 1, cover_file_id: 2 });
		await updateItem(
			database,
			itemId,
			validItem({ type: 'post', title: 'Media', slug: 'media', iconFileId: '', coverFileId: 1 })
		);
		expect(
			sqlite.prepare('SELECT icon_file_id,cover_file_id FROM items WHERE id=?').get(itemId)
		).toEqual({ icon_file_id: null, cover_file_id: 1 });
		await expect(
			createItem(
				database,
				validItem({ type: 'post', title: 'Bad', slug: 'bad', iconFileId: 3 }),
				null
			)
		).rejects.toMatchObject({ field: 'iconFileId' });
		await expect(
			createItem(
				database,
				validItem({ type: 'post', title: 'Missing', slug: 'missing', coverFileId: 99 }),
				null
			)
		).rejects.toMatchObject({ field: 'coverFileId' });
	});
	it('creates and synchronizes a complete content record', async () => {
		const { database, sqlite } = createDatabase();
		const categoryId = await createCategory(
			database,
			validCategory({ type: 'site', name: '开发工具', slug: 'dev-tools', sortOrder: 10 })
		);
		const tagId = await createTag(database, validTag({ type: 'site', name: '开发', slug: 'dev' }));
		const itemId = await createItem(
			database,
			validItem({
				type: 'site',
				categoryId,
				title: 'GitHub',
				slug: 'github',
				status: 'published',
				visibility: 'public',
				isFeatured: true,
				tagIds: [tagId],
				meta: { site_url: 'https://github.com', site_type: 'service' }
			}),
			null
		);

		const item = sqlite
			.prepare('SELECT title, category_id, is_featured, published_at FROM items WHERE id = ?')
			.get(itemId) as Record<string, unknown>;
		expect(item).toMatchObject({ title: 'GitHub', category_id: categoryId, is_featured: 1 });
		expect(item.published_at).toEqual(expect.any(String));
		expect(
			sqlite.prepare('SELECT tag_id FROM item_tags WHERE item_id = ?').get(itemId)
		).toMatchObject({
			tag_id: tagId
		});
		expect(
			sqlite
				.prepare('SELECT meta_value FROM item_meta WHERE item_id = ? AND meta_key = ?')
				.get(itemId, 'site_url')
		).toMatchObject({ meta_value: 'https://github.com' });
	});

	it('updates core fields and replaces tags and metadata atomically', async () => {
		const { database, sqlite } = createDatabase();
		const categoryId = await createCategory(
			database,
			validCategory({ type: 'site', name: '工具', slug: 'tools' })
		);
		const oldTag = await createTag(database, validTag({ type: 'site', name: '旧', slug: 'old' }));
		const newTag = await createTag(database, validTag({ type: 'site', name: '新', slug: 'new' }));
		const itemId = await createItem(
			database,
			validItem({
				type: 'site',
				categoryId,
				title: '旧标题',
				slug: 'old-title',
				tagIds: [oldTag],
				meta: { site_url: 'https://example.com/old' }
			}),
			null
		);

		await updateItem(
			database,
			itemId,
			validItem({
				type: 'site',
				categoryId,
				title: '新标题',
				slug: 'new-title',
				status: 'published',
				visibility: 'private',
				tagIds: [newTag],
				meta: { site_url: 'https://example.com/new' }
			})
		);

		expect(
			sqlite.prepare('SELECT title, visibility FROM items WHERE id = ?').get(itemId)
		).toMatchObject({
			title: '新标题',
			visibility: 'private'
		});
		expect(sqlite.prepare('SELECT tag_id FROM item_tags WHERE item_id = ?').all(itemId)).toEqual([
			{ tag_id: newTag }
		]);
		expect(
			sqlite.prepare('SELECT meta_value FROM item_meta WHERE item_id = ?').all(itemId)
		).toEqual([{ meta_value: 'https://example.com/new' }]);
	});

	it('rejects mismatched relations and category cycles', async () => {
		const { database } = createDatabase();
		const postCategory = await createCategory(
			database,
			validCategory({ type: 'post', name: '文章', slug: 'posts' })
		);
		await expect(
			createItem(
				database,
				validItem({
					type: 'site',
					categoryId: postCategory,
					title: '错误关系',
					slug: 'wrong-relation',
					meta: { site_url: 'https://example.com' }
				}),
				null
			)
		).rejects.toMatchObject({ field: 'categoryId' });

		const rootId = await createCategory(
			database,
			validCategory({ type: 'site', name: '根分类', slug: 'root' })
		);
		const childId = await createCategory(
			database,
			validCategory({ type: 'site', parentId: rootId, name: '子分类', slug: 'child' })
		);
		await expect(
			updateCategory(
				database,
				rootId,
				validCategory({ type: 'site', parentId: childId, name: '根分类', slug: 'root' })
			)
		).rejects.toBeInstanceOf(AdminWriteError);
	});

	it('prevents referenced categories and tags from changing content type', async () => {
		const { database } = createDatabase();
		const categoryId = await createCategory(
			database,
			validCategory({ type: 'site', name: '网址', slug: 'sites' })
		);
		const tagId = await createTag(
			database,
			validTag({ type: 'site', name: '工具', slug: 'tools' })
		);
		await createItem(
			database,
			validItem({
				type: 'site',
				categoryId,
				title: '示例',
				slug: 'example',
				tagIds: [tagId],
				meta: { site_url: 'https://example.com' }
			}),
			null
		);

		await expect(
			updateCategory(
				database,
				categoryId,
				validCategory({ type: 'post', name: '网址', slug: 'sites' })
			)
		).rejects.toMatchObject({ field: 'type' });
		await expect(
			updateTag(database, tagId, validTag({ type: 'post', name: '工具', slug: 'tools' }))
		).rejects.toMatchObject({ field: 'type' });
	});

	it('updates and deletes standalone records with not-found protection', async () => {
		const { database, sqlite } = createDatabase();
		const categoryId = await createCategory(
			database,
			validCategory({ type: 'site', name: '临时分类', slug: 'temporary' })
		);
		const tagId = await createTag(database, validTag({ type: 'site', name: '临时', slug: 'temp' }));
		await updateTag(database, tagId, validTag({ type: 'site', name: '已更新', slug: 'updated' }));
		expect(sqlite.prepare('SELECT name FROM tags WHERE id = ?').get(tagId)).toEqual({
			name: '已更新'
		});

		const itemId = await createItem(
			database,
			validItem({
				type: 'site',
				categoryId,
				title: '临时内容',
				slug: 'temporary-item',
				meta: { site_url: 'https://example.com' }
			}),
			null
		);
		await deleteItem(database, itemId);
		await deleteTag(database, tagId);
		await deleteCategory(database, categoryId);
		expect(sqlite.prepare('SELECT COUNT(*) AS count FROM items').get()).toEqual({ count: 0 });
		await expect(deleteItem(database, itemId)).rejects.toBeInstanceOf(AdminWriteError);
	});
});
