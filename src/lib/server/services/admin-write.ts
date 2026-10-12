import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { isManagedCategoryType } from '$lib/category-types';
import type {
	CategoryInput,
	HomeModuleInput,
	ItemInput,
	SearchEngineInput,
	TagInput
} from '$lib/server/admin-validation';

export class AdminWriteError extends Error {
	constructor(
		message: string,
		public readonly field?: string,
		public readonly status: 400 | 404 | 409 = 400
	) {
		super(message);
		this.name = 'AdminWriteError';
	}
}

type IdRow = { id: number };

async function returningId(
	statement: DatabaseStatement,
	notFoundMessage?: string
): Promise<number> {
	const { results } = await statement.all<IdRow>();
	const id = results[0]?.id;
	if (!id) {
		throw new AdminWriteError(
			notFoundMessage ?? '写入数据库失败。',
			undefined,
			notFoundMessage ? 404 : 400
		);
	}
	return id;
}

async function executeBatch(database: Database, statements: DatabaseStatement[]): Promise<void> {
	const batch = (
		database as Database & {
			batch?: (statements: DatabaseStatement[]) => Promise<unknown>;
		}
	).batch;

	if (batch) {
		await batch.call(database, statements);
		return;
	}

	for (const statement of statements) await statement.all();
}

async function rowExists(database: Database, query: string, values: DatabaseValue[]) {
	const { results } = await database
		.prepare(query)
		.bind(...values)
		.all<IdRow>();
	return Boolean(results[0]);
}

async function validateCategoryParent(
	database: Database,
	input: CategoryInput,
	categoryId?: number
): Promise<void> {
	if (!input.parentId) return;
	if (input.parentId === categoryId) {
		throw new AdminWriteError('分类不能将自己设为父级。', 'parentId');
	}

	const parentMatches = await rowExists(
		database,
		'SELECT id FROM categories WHERE id = ? AND type = ? LIMIT 1',
		[input.parentId, input.type]
	);
	if (!parentMatches) {
		throw new AdminWriteError('父级分类不存在或内容类型不一致。', 'parentId');
	}

	if (!categoryId) return;
	const createsCycle = await rowExists(
		database,
		`WITH RECURSIVE descendants(id) AS (
			SELECT id FROM categories WHERE parent_id = ?
			UNION ALL
			SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
		)
		SELECT id FROM descendants WHERE id = ? LIMIT 1`,
		[categoryId, input.parentId]
	);
	if (createsCycle) throw new AdminWriteError('父级分类不能选择当前分类的子级。', 'parentId');
}

async function preventReferencedCategoryTypeChange(
	database: Database,
	categoryId: number,
	type: CategoryInput['type']
): Promise<void> {
	const hasIncompatibleReferences = await rowExists(
		database,
		`SELECT id FROM categories
		 WHERE id = ? AND type <> ? AND (
			EXISTS (SELECT 1 FROM categories child WHERE child.parent_id = categories.id)
			OR EXISTS (SELECT 1 FROM items WHERE items.category_id = categories.id)
		 ) LIMIT 1`,
		[categoryId, type]
	);
	if (hasIncompatibleReferences) {
		throw new AdminWriteError('被子分类或内容引用的分类不能修改内容类型。', 'type');
	}
}

async function preventReferencedTagTypeChange(
	database: Database,
	tagId: number,
	type: TagInput['type']
): Promise<void> {
	const hasIncompatibleReferences = await rowExists(
		database,
		`SELECT id FROM tags
		 WHERE id = ? AND type <> ?
			AND EXISTS (SELECT 1 FROM item_tags WHERE item_tags.tag_id = tags.id)
		 LIMIT 1`,
		[tagId, type]
	);
	if (hasIncompatibleReferences) {
		throw new AdminWriteError('被内容引用的标签不能修改内容类型。', 'type');
	}
}

async function validateItemRelations(database: Database, input: ItemInput): Promise<void> {
	if (input.categoryId) {
		const categoryMatches = await rowExists(
			database,
			'SELECT id FROM categories WHERE id = ? AND type = ? LIMIT 1',
			[input.categoryId, input.type]
		);
		if (!categoryMatches) {
			throw new AdminWriteError('分类不存在或内容类型不一致。', 'categoryId');
		}
	}

	for (const [field, fileId] of [
		['iconFileId', input.iconFileId],
		['coverFileId', input.coverFileId]
	] as const) {
		if (!fileId) continue;
		const validImage = await rowExists(
			database,
			"SELECT id FROM files WHERE id = ? AND mime_type LIKE 'image/%' LIMIT 1",
			[fileId]
		);
		if (!validImage) throw new AdminWriteError('媒体文件不存在或不是图片。', field);
	}

	if (input.tagIds.length === 0) return;
	const placeholders = input.tagIds.map(() => '?').join(', ');
	const { results } = await database
		.prepare(`SELECT id FROM tags WHERE type = ? AND id IN (${placeholders})`)
		.bind(input.type, ...input.tagIds)
		.all<IdRow>();
	if (results.length !== input.tagIds.length) {
		throw new AdminWriteError('一个或多个标签不存在，或内容类型不一致。', 'tagIds');
	}
}

function itemRelationStatements(database: Database, itemId: number, input: ItemInput) {
	const statements: DatabaseStatement[] = [
		database.prepare('DELETE FROM item_tags WHERE item_id = ?').bind(itemId),
		database.prepare('DELETE FROM item_meta WHERE item_id = ?').bind(itemId)
	];

	for (const tagId of input.tagIds) {
		statements.push(
			database.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)').bind(itemId, tagId)
		);
	}
	for (const [key, value] of Object.entries(input.meta)) {
		statements.push(
			database
				.prepare('INSERT INTO item_meta (item_id, meta_key, meta_value) VALUES (?, ?, ?)')
				.bind(itemId, key, value)
		);
	}

	return statements;
}

export async function createCategory(database: Database, input: CategoryInput): Promise<number> {
	if (!isManagedCategoryType(input.type)) {
		throw new AdminWriteError('新分类只支持网址和文章。', 'type');
	}
	await validateCategoryParent(database, input);
	return returningId(
		database
			.prepare(
				`INSERT INTO categories
					(type, parent_id, name, slug, icon, description, sort_order, is_visible)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 RETURNING id`
			)
			.bind(
				input.type,
				input.parentId,
				input.name,
				input.slug,
				input.icon,
				input.description,
				input.sortOrder,
				input.isVisible ? 1 : 0
			)
	);
}

export async function updateCategory(
	database: Database,
	categoryId: number,
	input: CategoryInput
): Promise<void> {
	if (!isManagedCategoryType(input.type)) {
		const retainsLegacyType = await rowExists(
			database,
			'SELECT id FROM categories WHERE id = ? AND type = ? LIMIT 1',
			[categoryId, input.type]
		);
		if (!retainsLegacyType)
			throw new AdminWriteError('分类只支持网址和文章；历史分类只能保留原类型。', 'type');
	}
	await preventReferencedCategoryTypeChange(database, categoryId, input.type);
	await validateCategoryParent(database, input, categoryId);
	await returningId(
		database
			.prepare(
				`UPDATE categories SET type = ?, parent_id = ?, name = ?, slug = ?, icon = ?,
					description = ?, sort_order = ?, is_visible = ?, updated_at = CURRENT_TIMESTAMP
				 WHERE id = ? RETURNING id`
			)
			.bind(
				input.type,
				input.parentId,
				input.name,
				input.slug,
				input.icon,
				input.description,
				input.sortOrder,
				input.isVisible ? 1 : 0,
				categoryId
			),
		'分类不存在。'
	);
}

export async function deleteCategory(database: Database, categoryId: number): Promise<void> {
	await returningId(
		database.prepare('DELETE FROM categories WHERE id = ? RETURNING id').bind(categoryId),
		'分类不存在。'
	);
}

export async function createTag(database: Database, input: TagInput): Promise<number> {
	return returningId(
		database
			.prepare('INSERT INTO tags (type, name, slug, description) VALUES (?, ?, ?, ?) RETURNING id')
			.bind(input.type, input.name, input.slug, input.description)
	);
}

export async function updateTag(database: Database, tagId: number, input: TagInput): Promise<void> {
	await preventReferencedTagTypeChange(database, tagId, input.type);
	await returningId(
		database
			.prepare(
				`UPDATE tags SET type = ?, name = ?, slug = ?, description = ?,
					updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING id`
			)
			.bind(input.type, input.name, input.slug, input.description, tagId),
		'标签不存在。'
	);
}

export async function deleteTag(database: Database, tagId: number): Promise<void> {
	await returningId(
		database.prepare('DELETE FROM tags WHERE id = ? RETURNING id').bind(tagId),
		'标签不存在。'
	);
}

export async function createItem(
	database: Database,
	input: ItemInput,
	authorId: number | null
): Promise<number> {
	await validateItemRelations(database, input);
	const itemId = await returningId(
		database
			.prepare(
				`INSERT INTO items
					(type, category_id, author_id, title, slug, summary, content, icon_file_id, cover_file_id, status, visibility,
					 sort_order, is_featured, published_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
					CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END)
				 RETURNING id`
			)
			.bind(
				input.type,
				input.categoryId,
				authorId,
				input.title,
				input.slug,
				input.summary,
				input.content,
				input.iconFileId,
				input.coverFileId,
				input.status,
				input.visibility,
				input.sortOrder,
				input.isFeatured ? 1 : 0,
				input.status
			)
	);

	try {
		await executeBatch(database, itemRelationStatements(database, itemId, input));
	} catch (error) {
		await database.prepare('DELETE FROM items WHERE id = ?').bind(itemId).all();
		throw error;
	}

	return itemId;
}

export async function updateItem(
	database: Database,
	itemId: number,
	input: ItemInput
): Promise<void> {
	await validateItemRelations(database, input);
	const exists = await rowExists(database, 'SELECT id FROM items WHERE id = ? LIMIT 1', [itemId]);
	if (!exists) throw new AdminWriteError('内容不存在。', undefined, 404);

	const update = database
		.prepare(
			`UPDATE items SET type = ?, category_id = ?, title = ?, slug = ?, summary = ?, content = ?,
				icon_file_id = ?, cover_file_id = ?, status = ?, visibility = ?, sort_order = ?, is_featured = ?,
				published_at = CASE
					WHEN ? = 'published' THEN COALESCE(published_at, CURRENT_TIMESTAMP)
					ELSE NULL
				END,
				updated_at = CURRENT_TIMESTAMP
			 WHERE id = ?`
		)
		.bind(
			input.type,
			input.categoryId,
			input.title,
			input.slug,
			input.summary,
			input.content,
			input.iconFileId,
			input.coverFileId,
			input.status,
			input.visibility,
			input.sortOrder,
			input.isFeatured ? 1 : 0,
			input.status,
			itemId
		);
	await executeBatch(database, [update, ...itemRelationStatements(database, itemId, input)]);
}

export async function deleteItem(database: Database, itemId: number): Promise<void> {
	await returningId(
		database.prepare('DELETE FROM items WHERE id = ? RETURNING id').bind(itemId),
		'内容不存在。'
	);
}

export async function createHomeModule(
	database: Database,
	input: HomeModuleInput
): Promise<number> {
	return returningId(
		database
			.prepare(
				'INSERT INTO home_modules (type, title, config_json, sort_order, is_enabled) VALUES (?, ?, ?, ?, ?) RETURNING id'
			)
			.bind(
				input.type,
				input.title,
				JSON.stringify(input.config),
				input.sortOrder,
				input.isEnabled ? 1 : 0
			)
	);
}

export async function updateHomeModule(
	database: Database,
	id: number,
	input: HomeModuleInput
): Promise<void> {
	await returningId(
		database
			.prepare(
				'UPDATE home_modules SET type = ?, title = ?, config_json = ?, sort_order = ?, is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING id'
			)
			.bind(
				input.type,
				input.title,
				JSON.stringify(input.config),
				input.sortOrder,
				input.isEnabled ? 1 : 0,
				id
			),
		'首页模块不存在。'
	);
}

export async function deleteHomeModule(database: Database, id: number): Promise<void> {
	await returningId(
		database.prepare('DELETE FROM home_modules WHERE id = ? RETURNING id').bind(id),
		'首页模块不存在。'
	);
}

export async function createSearchEngine(
	database: Database,
	input: SearchEngineInput
): Promise<number> {
	return returningId(
		database
			.prepare(
				'INSERT INTO search_engines (group_key, name, key, url_template, placeholder, sort_order, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id'
			)
			.bind(
				input.groupKey,
				input.name,
				input.key,
				input.urlTemplate,
				input.placeholder,
				input.sortOrder,
				input.isEnabled ? 1 : 0
			)
	);
}

export async function updateSearchEngine(
	database: Database,
	id: number,
	input: SearchEngineInput
): Promise<void> {
	await returningId(
		database
			.prepare(
				'UPDATE search_engines SET group_key = ?, name = ?, key = ?, url_template = ?, placeholder = ?, sort_order = ?, is_enabled = ? WHERE id = ? RETURNING id'
			)
			.bind(
				input.groupKey,
				input.name,
				input.key,
				input.urlTemplate,
				input.placeholder,
				input.sortOrder,
				input.isEnabled ? 1 : 0,
				id
			),
		'搜索源不存在。'
	);
}

export async function deleteSearchEngine(database: Database, id: number): Promise<void> {
	await returningId(
		database.prepare('DELETE FROM search_engines WHERE id = ? RETURNING id').bind(id),
		'搜索源不存在。'
	);
}
