import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { searchContent, searchFallback } from '$lib/server/services/content-pages';
import { listItems } from '$lib/server/services/items';
import { navigationItems } from '$lib/data/navigation';
import { SEARCH_PAGE_SIZE, parseSearchPage } from '$lib/search';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
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
							.all(
								...values.map((value) =>
									value instanceof ArrayBuffer ? new Uint8Array(value) : value
								)
							) as T[]
					};
				}
			};
			return statement;
		}
	};
	const insert = (
		title: string,
		summary = '',
		order = 0,
		status = 'published',
		visibility = 'public'
	) => {
		const result = sqlite
			.prepare(
				'INSERT INTO items(title,slug,summary,sort_order,status,visibility) VALUES(?,?,?,?,?,?)'
			)
			.run(
				title,
				'item-' + sqlite.prepare('SELECT COUNT(*) AS count FROM items').get()!.count,
				summary,
				order,
				status,
				visibility
			);
		return Number(result.lastInsertRowid);
	};
	return { database, sqlite, insert };
}
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

describe('public content search', () => {
	it('ranks exact, prefix, title substring, summary and taxonomy matches in that order', async () => {
		const { database, sqlite, insert } = fixture();
		const summary = insert('代码托管', 'GitHub 项目协作', -100);
		insert('My GitHub notes', '', -90);
		insert('GitHub Docs', '', -80);
		insert('GitHub', '', 100);
		const category = insert('团队工具', '', -110);
		sqlite.exec("INSERT INTO categories(id,name,slug) VALUES(1,'GitHub 资源','github-resources')");
		sqlite.prepare('UPDATE items SET category_id=1 WHERE id=?').run(category);
		const result = await searchContent(database, ' github ');
		expect(result.items.map((item) => item.title)).toEqual([
			'GitHub',
			'GitHub Docs',
			'My GitHub notes',
			'代码托管',
			'团队工具'
		]);
		expect(result.total).toBe(5);
		// Other item lists still obey saved ordering.
		expect((await listItems(database))[0].id).toBe(category);
		expect((await listItems(database)).find((item) => item.id === summary)?.summary).toContain(
			'协作'
		);
	});

	it('finds categories and tags without duplicating items or exposing private/draft rows', async () => {
		const { database, sqlite, insert } = fixture();
		const first = insert('A');
		const second = insert('B');
		insert('中文开发', '', 0, 'draft');
		insert('中文开发', '', 0, 'published', 'private');
		sqlite.exec(
			"INSERT INTO categories(id,name,slug) VALUES(1,'中文开发','chinese-dev'); INSERT INTO tags(id,name,slug) VALUES(1,'中文开发工具','chinese-tools'),(2,'中文开发协作','chinese-team')"
		);
		sqlite.prepare('UPDATE items SET category_id=1 WHERE id=?').run(first);
		sqlite.prepare('INSERT INTO item_tags(item_id,tag_id) VALUES(?,1),(?,2)').run(second, second);
		const result = await searchContent(database, '中文开发');
		expect(result.total).toBe(2);
		expect(result.items.map((item) => item.title)).toEqual(['A', 'B']);
		expect(result.items[1].tags).toHaveLength(2);
	});

	it('treats LIKE metacharacters and quotes as literal input', async () => {
		const { database, insert } = fixture();
		insert('100%_\\guide');
		insert('100ABguide');
		insert("' OR 1=1 --");
		expect((await searchContent(database, '%_\\')).items.map((item) => item.title)).toEqual([
			'100%_\\guide'
		]);
		expect((await searchContent(database, "' OR 1=1 --")).total).toBe(1);
		expect((await searchContent(database, '_')).total).toBe(1);
	});

	it('counts all 61 matches and reaches later pages with stable, nonoverlapping results', async () => {
		const { database, insert } = fixture();
		for (let index = 0; index < 61; index++) insert('共同资源');
		insert('共同资源', '', 0, 'draft');
		insert('共同资源', '', 0, 'published', 'private');
		const pages = await Promise.all(
			[1, 2, 3].map((page) => searchContent(database, '共同资源', page))
		);
		expect(pages.map((page) => page.items.length)).toEqual([
			SEARCH_PAGE_SIZE,
			SEARCH_PAGE_SIZE,
			13
		]);
		for (const page of pages) {
			expect(page.total).toBe(61);
			expect(page.pageCount).toBe(3);
			expect(page.description).toBe('找到 61 条相关内容');
		}
		expect(new Set(pages.flatMap((page) => page.items.map((item) => item.slug))).size).toBe(61);
		expect((await searchContent(database, '共同资源', 999)).page).toBe(3);
		expect(await searchContent(database, '不存在', 999)).toMatchObject({
			page: 1,
			total: 0,
			pageCount: 0,
			items: []
		});
	});

	it('does not query the database for an empty search', async () => {
		const database: Database = {
			prepare() {
				throw new Error('must not query');
			}
		};
		expect(await searchContent(database, '  ', 100)).toMatchObject({
			query: '',
			items: [],
			total: 0,
			page: 1
		});
	});

	it('uses the same English/Chinese taxonomy matching and relevance in fallback data', async () => {
		const { database, sqlite } = fixture();
		for (const [index, item] of navigationItems.entries()) {
			const category = Number(
				sqlite
					.prepare('INSERT INTO categories(name,slug) VALUES(?,?)')
					.run(item.category, 'category-' + index).lastInsertRowid
			);
			const id = Number(
				sqlite
					.prepare(
						'INSERT INTO items(type,title,slug,summary,category_id,sort_order) VALUES(?,?,?,?,?,?)'
					)
					.run(item.type, item.title, item.slug, item.summary, category, index).lastInsertRowid
			);
			for (const [tagIndex, tag] of item.tags.entries()) {
				const tagId = Number(
					sqlite
						.prepare('INSERT INTO tags(name,slug) VALUES(?,?)')
						.run(tag.name, 'tag-' + index + '-' + tagIndex).lastInsertRowid
				);
				sqlite.prepare('INSERT INTO item_tags(item_id,tag_id) VALUES(?,?)').run(id, tagId);
			}
		}
		for (const query of ['github', 'prototype', '开发工具', '设计', '不存在']) {
			const live = await searchContent(database, query);
			const local = searchFallback(query);
			expect(live.items.map((item) => item.slug)).toEqual(local.items.map((item) => item.slug));
			expect(live.total).toBe(local.total);
		}
	});

	it.each(['0', '-1', '1.5', '01', 'Infinity', '9007199254740992', 'abc', null])(
		'normalizes an invalid page %s',
		(value) => {
			expect(parseSearchPage(value)).toBe(1);
		}
	);
});
