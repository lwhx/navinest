import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import { buildHomeCategoryLinks } from '$lib/home-category-navigation';
import { loadHomeData } from '$lib/server/services/home';
import { categoryContent } from '$lib/server/services/content-pages';

it('keeps retired database categories out of the entire home plan without modifying stored data', async () => {
	const sqlite = new DatabaseSync(':memory:');
	try {
		for (const migration of ['0001_initial', '0012_hot_board_customization']) {
			sqlite.exec(readFileSync(`migrations/${migration}.sql`, 'utf8'));
		}
		sqlite.exec(`
			INSERT INTO categories(id,type,parent_id,name,slug,sort_order) VALUES
			(1,'site',NULL,'常用推荐','favorites',10),(2,'site',NULL,'开发工具','dev-tools',20),
			(3,'app',NULL,'效率工具','productivity',30),(4,'book',NULL,'书籍影视','bookshelf',40),
			(5,'post',NULL,'文章摘录','notes',50),(6,'bulletin',NULL,'站点公告','announcements',60),
			(7,'post',NULL,'使用教程','guides',70),(8,'book',NULL,'已改名的书籍','reading',80),
			(9,'bulletin',NULL,'已改名的公告','notices',90),(10,'site',2,'前端开发','frontend',100),
			(11,'site',10,'深层框架','frameworks',110);
			INSERT INTO items(type,category_id,title,slug,summary,status,visibility)
			SELECT type,id,name || '内容','item-' || id,'真实用途说明','published','public' FROM categories;
			INSERT INTO item_meta(item_id,meta_key,meta_value)
			SELECT id,'site_url','https://example.com/item-' || id FROM items WHERE type='site';
			INSERT INTO home_modules(id,type,title,config_json,sort_order,is_enabled) VALUES
			(1,'search','搜索','{}',10,1),
			(2,'content','常用推荐','{"categorySlug":"favorites","custom":"keep"}',20,1),
			(3,'content','显式书籍模块','{"categorySlug":"bookshelf","custom":"keep"}',30,1),
			(4,'content','显式文章摘录模块','{"categorySlug":"notes","custom":"keep"}',40,1),
			(5,'content','显式公告模块','{"categorySlug":"announcements","custom":"keep"}',50,1),
			(6,'ranking','排行榜','{}',100,1);
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
		const snapshot = () =>
			['categories', 'items', 'home_modules'].map((table) =>
				sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
			);
		const before = snapshot();
		const home = await loadHomeData(database);
		expect(home.source).toBe('database');
		expect(home.categories.find((category) => category.slug === 'reading')?.type).toBe('book');
		expect(home.modulePlan.map((module) => module.key)).toEqual([
			'search:1',
			'content:favorites',
			'content:dev-tools',
			'content:productivity',
			'content:guides',
			'ranking:6'
		]);
		expect(
			buildHomeCategoryLinks(home.modulePlan, home.sections).map((category) => category.slug)
		).toEqual(['favorites', 'dev-tools', 'productivity', 'guides']);
		const tools = home.sections.find((section) => section.slug === 'dev-tools')!;
		expect(tools.children.map((category) => category.slug)).toEqual(['frontend']);
		expect(tools.items.map((item) => item.slug)).toEqual(
			expect.arrayContaining(['item-2', 'item-10', 'item-11'])
		);
		expect(tools.itemsByChild?.frontend.map((item) => item.slug)).toEqual(
			expect.arrayContaining(['item-10', 'item-11'])
		);
		expect((await categoryContent(database, 'dev-tools'))?.items.map((item) => item.slug)).toEqual(
			expect.arrayContaining(['item-2', 'item-10', 'item-11'])
		);
		expect((await categoryContent(database, 'frontend'))?.items.map((item) => item.slug)).toEqual(
			expect.arrayContaining(['item-10', 'item-11'])
		);
		expect(home.dashboard.popular.map((item) => item.type)).toContain('post');
		expect(snapshot()).toEqual(before);
	} finally {
		sqlite.close();
	}
});
