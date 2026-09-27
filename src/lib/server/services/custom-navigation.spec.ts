import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	CustomNavigationError,
	createCustomCategory,
	createCustomLink,
	deleteCustomCategory,
	deleteCustomLink,
	listCustomNavigation,
	reorderCustomCategories,
	reorderCustomLinks,
	updateCustomCategory,
	updateCustomLink
} from '$lib/server/services/custom-navigation';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
		PRAGMA foreign_keys=ON;
		CREATE TABLE custom_categories(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,parent_id INTEGER,name TEXT NOT NULL,icon TEXT,sort_order INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
		CREATE TABLE custom_links(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,category_id INTEGER REFERENCES custom_categories(id) ON DELETE SET NULL,title TEXT NOT NULL,url TEXT NOT NULL,icon_url TEXT,summary TEXT,sort_order INTEGER DEFAULT 0,status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
	`);
	const database: Database = {
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
	return { sqlite, database };
}
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('custom navigation', () => {
	it('isolates categories and links by user while preserving order', async () => {
		const { database } = fixture();
		const work = await createCustomCategory(database, 7, {
			name: 'Work',
			icon: 'briefcase',
			sortOrder: 20
		});
		const first = await createCustomLink(database, 7, {
			categoryId: work,
			title: 'GitHub',
			url: 'https://github.com',
			summary: 'Code',
			sortOrder: 20,
			status: 'active'
		});
		await createCustomLink(database, 8, {
			categoryId: null,
			title: 'Other',
			url: 'https://example.com',
			summary: null,
			sortOrder: 0,
			status: 'active'
		});
		await updateCustomCategory(database, 7, work, {
			name: 'Development',
			icon: null,
			sortOrder: 10
		});
		await updateCustomLink(database, 7, first, {
			categoryId: work,
			title: 'GitHub',
			url: 'https://github.com/',
			summary: null,
			sortOrder: 5,
			status: 'inactive'
		});
		const navigation = await listCustomNavigation(database, 7);
		expect(navigation.categories).toMatchObject([{ id: work, name: 'Development', sortOrder: 10 }]);
		expect(navigation.links).toMatchObject([
			{ id: first, title: 'GitHub', sortOrder: 5, status: 'inactive' }
		]);
	});
	it('rejects unsafe URLs and categories owned by another user', async () => {
		const { database } = fixture();
		const foreign = await createCustomCategory(database, 8, {
			name: 'Foreign',
			icon: null,
			sortOrder: 0
		});
		await expect(
			createCustomLink(database, 7, {
				categoryId: null,
				title: 'Local',
				url: 'http://127.0.0.1',
				summary: null,
				sortOrder: 0,
				status: 'active'
			})
		).rejects.toBeInstanceOf(CustomNavigationError);
		await expect(
			createCustomLink(database, 7, {
				categoryId: foreign,
				title: 'Cross tenant',
				url: 'https://example.com',
				summary: null,
				sortOrder: 0,
				status: 'active'
			})
		).rejects.toBeInstanceOf(CustomNavigationError);
	});
	it('keeps links unclassified when a category is deleted and blocks cross-user mutations', async () => {
		const { sqlite, database } = fixture();
		const category = await createCustomCategory(database, 7, {
			name: 'Work',
			icon: null,
			sortOrder: 0
		});
		const link = await createCustomLink(database, 7, {
			categoryId: category,
			title: 'GitHub',
			url: 'https://github.com',
			summary: null,
			sortOrder: 0,
			status: 'active'
		});
		await deleteCustomCategory(database, 7, category);
		expect(
			sqlite.prepare('SELECT category_id FROM custom_links WHERE id=?').get(link)
		).toMatchObject({ category_id: null });
		await expect(deleteCustomLink(database, 8, link)).rejects.toBeInstanceOf(CustomNavigationError);
		await deleteCustomLink(database, 7, link);
		expect(sqlite.prepare('SELECT COUNT(*) count FROM custom_links').get()).toMatchObject({
			count: 0
		});
	});
});

describe('custom navigation ordering', () => {
	async function threeLinks(database: Database) {
		const ids: number[] = [];
		for (const [index, title] of ['A', 'B', 'C'].entries())
			ids.push(
				await createCustomLink(database, 7, {
					categoryId: null,
					title,
					url: `https://example.com/${title.toLowerCase()}`,
					summary: null,
					sortOrder: index * 10,
					status: 'active'
				})
			);
		return ids;
	}

	it('persists a new order and spaces sort_order by ten', async () => {
		const { sqlite, database } = fixture();
		const [a, b, c] = await threeLinks(database);
		expect(await reorderCustomLinks(database, 7, [c, a, b])).toBe(3);
		expect(
			sqlite.prepare('SELECT id,sort_order FROM custom_links ORDER BY sort_order').all()
		).toEqual([
			{ id: c, sort_order: 10 },
			{ id: a, sort_order: 20 },
			{ id: b, sort_order: 30 }
		]);
		const navigation = await listCustomNavigation(database, 7);
		expect(navigation.links.map((item) => item.id)).toEqual([c, a, b]);
	});

	it('deduplicates ids and only touches the records it is given', async () => {
		const { sqlite, database } = fixture();
		const [a, b, c] = await threeLinks(database);
		expect(await reorderCustomLinks(database, 7, [b, b, c])).toBe(2);
		expect(sortOrders(sqlite)).toEqual([
			{ id: a, sort_order: 0 },
			{ id: b, sort_order: 10 },
			{ id: c, sort_order: 20 }
		]);
	});

	it('reorders categories without leaking across users', async () => {
		const { sqlite, database } = fixture();
		const work = await createCustomCategory(database, 7, {
			name: 'Work',
			icon: null,
			sortOrder: 0
		});
		const fun = await createCustomCategory(database, 7, {
			name: 'Fun',
			icon: null,
			sortOrder: 10
		});
		const foreign = await createCustomCategory(database, 8, {
			name: 'Foreign',
			icon: null,
			sortOrder: 0
		});
		expect(await reorderCustomCategories(database, 7, [fun, work])).toBe(2);
		expect(
			sqlite.prepare('SELECT id,sort_order FROM custom_categories ORDER BY sort_order').all()
		).toEqual([
			{ id: foreign, sort_order: 0 },
			{ id: fun, sort_order: 10 },
			{ id: work, sort_order: 20 }
		]);
		await expect(reorderCustomCategories(database, 7, [foreign])).rejects.toMatchObject({
			status: 404
		});
	});

	it('rejects empty, oversized and malformed payloads', async () => {
		const { database } = fixture();
		const [a] = await threeLinks(database);
		await expect(reorderCustomLinks(database, 7, [])).rejects.toBeInstanceOf(CustomNavigationError);
		await expect(reorderCustomLinks(database, 7, [0, -1, Number.NaN])).rejects.toThrow(
			'排序列表为空'
		);
		await expect(
			reorderCustomLinks(
				database,
				7,
				Array.from({ length: 501 }, (_, index) => index + 1)
			)
		).rejects.toThrow('一次最多调整 500 条记录');
		expect(await reorderCustomLinks(database, 7, [a])).toBe(1);
	});
});

function sortOrders(sqlite: DatabaseSync) {
	return sqlite.prepare('SELECT id,sort_order FROM custom_links ORDER BY sort_order,id').all();
}
