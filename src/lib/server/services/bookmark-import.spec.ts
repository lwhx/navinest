import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';
import {
	bookmarkUrlKey,
	importBookmarks,
	parseBookmarkHtml
} from '$lib/server/services/bookmark-import';

const connections: DatabaseSync[] = [];
function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
		PRAGMA foreign_keys=ON;
		CREATE TABLE custom_categories(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,parent_id INTEGER,name TEXT NOT NULL,icon TEXT,sort_order INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
		CREATE TABLE custom_links(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,category_id INTEGER REFERENCES custom_categories(id) ON DELETE SET NULL,title TEXT NOT NULL,url TEXT NOT NULL,icon_url TEXT,summary TEXT,sort_order INTEGER DEFAULT 0,status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
	`);
	const db: Database = {
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
	return { sqlite, db };
}
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

const bookmarks = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3 ADD_DATE="1">收藏夹栏</H3>
    <DL><p>
        <DT><A HREF="https://example.com/a" ADD_DATE="2">Example &amp; Co</A>
        <DT><H3>子目录</H3>
        <DL><p>
            <DT><A HREF="https://example.com/b">子项</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://example.org/top">顶层</A>
</DL><p>`;

describe('bookmark html parsing', () => {
	it('walks nested folders and decodes titles', () => {
		const parsed = parseBookmarkHtml(bookmarks);
		expect(parsed.skipped).toBe(0);
		expect(parsed.entries).toEqual([
			{ title: 'Example & Co', url: 'https://example.com/a', folder: '收藏夹栏' },
			{ title: '子项', url: 'https://example.com/b', folder: '收藏夹栏 / 子目录' },
			{ title: '顶层', url: 'https://example.org/top', folder: null }
		]);
	});

	it('skips unsafe targets and reports how many were dropped', () => {
		const parsed = parseBookmarkHtml(`
			<DL><p>
				<DT><A HREF="javascript:alert(1)">脚本</A>
				<DT><A HREF="place:sort=8">位置</A>
				<DT><A HREF="http://localhost:3000/x">本地</A>
				<DT><A HREF="file:///C:/secret.txt">文件</A>
				<DT><A HREF="https://example.com/ok">正常</A>
			</DL><p>`);
		expect(parsed.skipped).toBe(4);
		expect(parsed.entries).toEqual([
			{ title: '正常', url: 'https://example.com/ok', folder: null }
		]);
	});

	it('falls back to the host when a bookmark has no label', () => {
		expect(
			parseBookmarkHtml('<DL><p><DT><A HREF="https://fallback.dev/page"></A></DL>').entries
		).toEqual([{ title: 'fallback.dev', url: 'https://fallback.dev/page', folder: null }]);
	});

	it('rejects empty, oversized and link-free documents', () => {
		expect(() => parseBookmarkHtml('')).toThrow('请提供书签文件内容');
		expect(() => parseBookmarkHtml(null)).toThrow('请提供书签文件内容');
		expect(() => parseBookmarkHtml(`<DL>${'x'.repeat(2 * 1024 * 1024)}</DL>`)).toThrow('过大');
		expect(() => parseBookmarkHtml('<DL><p><DT><H3>只有文件夹</H3></DL>')).toThrow(
			'没有在文件中找到可导入的书签链接'
		);
	});

	it('caps huge exports instead of failing', () => {
		const anchor = '<DT><A HREF="https://example.com/%d">链接</A>';
		const html = `<DL><p>${Array.from({ length: 5005 }, (_, index) => anchor.replace('%d', String(index))).join('')}</DL>`;
		expect(parseBookmarkHtml(html).entries).toHaveLength(5000);
	});
});

describe('bookmark import', () => {
	it('creates a category per folder and skips duplicates by normalised url', async () => {
		const { db, sqlite } = fixture();
		const entries = [
			{ title: 'A', url: 'https://example.com/a', folder: '工作' },
			{ title: 'A 带斜杠', url: 'https://example.com/a/', folder: '工作' },
			{ title: 'B', url: 'https://example.org/b', folder: null }
		];
		const first = await importBookmarks(db, 7, entries);
		expect(first).toEqual({
			imported: 2,
			duplicates: 1,
			skipped: 0,
			limited: 0,
			folders: ['工作']
		});
		expect(sqlite.prepare('SELECT name FROM custom_categories WHERE user_id=7').all()).toEqual([
			{ name: '工作' }
		]);
		expect(
			sqlite
				.prepare(
					'SELECT title,url,status,category_id FROM custom_links WHERE user_id=7 ORDER BY id'
				)
				.all()
		).toEqual([
			{ title: 'A', url: 'https://example.com/a', status: 'active', category_id: 1 },
			{ title: 'B', url: 'https://example.org/b', status: 'active', category_id: null }
		]);
		const second = await importBookmarks(db, 7, entries);
		expect(second).toMatchObject({ imported: 0, duplicates: 3 });
		expect(sqlite.prepare('SELECT COUNT(*) count FROM custom_links').get()).toEqual({ count: 2 });
	});

	it('reuses existing categories and continues the sort order', async () => {
		const { db, sqlite } = fixture();
		sqlite.exec(
			"INSERT INTO custom_categories(user_id,name,sort_order) VALUES(7,'工作',0); INSERT INTO custom_links(user_id,category_id,title,url,sort_order,status) VALUES(7,1,'已有','https://example.com/existing',40,'active');"
		);
		const result = await importBookmarks(db, 7, [
			{ title: '新增', url: 'https://example.com/fresh', folder: '工作' }
		]);
		expect(result).toMatchObject({ imported: 1, folders: [] });
		expect(sqlite.prepare('SELECT COUNT(*) count FROM custom_categories').get()).toEqual({
			count: 1
		});
		expect(
			sqlite
				.prepare('SELECT sort_order FROM custom_links WHERE url=?')
				.get('https://example.com/fresh')
		).toEqual({ sort_order: 50 });
	});

	it('stops at the import limit and reports the remainder', async () => {
		const { db } = fixture();
		const entries = Array.from({ length: 4 }, (_, index) => ({
			title: `链接 ${index}`,
			url: `https://example.com/${index}`,
			folder: null
		}));
		const result = await importBookmarks(db, 7, entries, { limit: 2 });
		expect(result).toMatchObject({ imported: 2, limited: 2, folders: [] });
	});

	it('keeps each user import isolated and normalises keys', async () => {
		const { db, sqlite } = fixture();
		await importBookmarks(db, 7, [{ title: 'A', url: 'https://example.com/a', folder: null }]);
		const other = await importBookmarks(db, 8, [
			{ title: 'A', url: 'https://example.com/a', folder: null }
		]);
		expect(other.imported).toBe(1);
		expect(sqlite.prepare('SELECT COUNT(*) count FROM custom_links').get()).toEqual({ count: 2 });
		expect(bookmarkUrlKey('HTTPS://Example.com/a/')).toBe('https://example.com/a');
	});
});
