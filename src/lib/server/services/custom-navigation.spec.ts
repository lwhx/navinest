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
