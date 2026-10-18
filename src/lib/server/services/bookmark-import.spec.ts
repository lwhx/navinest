import { describe, expect, it } from 'vitest';
import { bookmarkUrlKey, parseBookmarkHtml, parseBookmarkDocument } from './bookmark-import';
const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>收藏夹栏</H3><DL><DT><A HREF="https://example.com/a?q=1&amp;x=2">Example &amp; Co</A><DT><H3>子目录</H3><DL><DT><A HREF="https://example.com/b">子项</A></DL></DL><DT><A HREF="https://example.org/top">顶层</A></DL>`;
describe('bookmark document parsing', () => {
	it('preserves folder paths, entities in URLs and safe text labels', () => {
		expect(parseBookmarkHtml(html)).toEqual({
			entries: [
				{ title: 'Example & Co', url: 'https://example.com/a?q=1&x=2', folder: '收藏夹栏' },
				{ title: '子项', url: 'https://example.com/b', folder: '收藏夹栏 / 子目录' },
				{ title: '顶层', url: 'https://example.org/top', folder: null }
			],
			skipped: 0
		});
	});
	it('keeps invalid entries visible with reasons and original stable positions', () => {
		const rows = parseBookmarkDocument(
			'<DL><A HREF="javascript:alert(1)">脚本</A><A>缺少网址</A><A HREF="http://localhost/x">本地</A><A HREF="https://example.com/ok"><b>正常</b>&#x1f600;&#20013;</A></DL>'
		);
		expect(rows.map((r) => r.id)).toEqual([0, 1, 2, 3]);
		expect(rows.slice(0, 3).every((r) => r.status === 'invalid' && !!r.error)).toBe(true);
		expect(rows[3].title).toBe('正常😀中');
	});
	it('retains distinct fragments, parameters and path slashes', () => {
		expect(bookmarkUrlKey('HTTPS://Example.COM')).toBe('https://example.com/');
		expect(
			new Set(
				[
					'https://example.com/a',
					'https://example.com/a/',
					'https://example.com/a#one',
					'https://example.com/a#two',
					'https://example.com/a?q=1',
					'https://example.com/a?q=2'
				].map(bookmarkUrlKey)
			).size
		).toBe(6);
	});
	it('rejects oversized UTF-8, link-free and over-limit files without truncating', () => {
		expect(() => parseBookmarkDocument('中'.repeat(800000))).toThrow('过大');
		expect(() => parseBookmarkDocument('<DL><H3>空目录</H3></DL>')).toThrow('没有');
		expect(() => parseBookmarkDocument('<A HREF="https://example.com">a</A>'.repeat(5001))).toThrow(
			'5000'
		);
		expect(parseBookmarkDocument('<A HREF="https://example.com">a</A>'.repeat(5000))).toHaveLength(
			5000
		);
	});
	it('bounds deep and long folder paths and handles malformed numeric entities', () => {
		expect(() =>
			parseBookmarkDocument('<DL>'.repeat(65) + '<A HREF="https://example.com">a</A>')
		).toThrow('层级');
		expect(
			parseBookmarkDocument(
				('<H3>' + '中'.repeat(160) + '</H3><DL>').repeat(4) +
					'<A HREF="https://example.com">&#999999999;</A>'
			)[0]
		).toMatchObject({ status: 'invalid', title: '�' });
	});
});
