import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateHomeModuleInput, validateSearchEngineInput } from '$lib/server/admin-validation';
import { buildHomeModulePlan } from '$lib/server/services/home-module-plan';
import { DEFAULT_SEARCH_RECOMMENDATIONS } from '$lib/search';

describe('recommended search configuration', () => {
	it('merges plain text recommendations into other saved module settings', () => {
		expect(
			validateHomeModuleInput({
				type: 'search',
				title: '搜索',
				configJson: '{"defaultGroup":"onsite","limit":6}',
				recommendedSearchesText: ' 团队协作 \r\n设计资源\n团队协作\n',
				sortOrder: 10
			})
		).toMatchObject({
			valid: true,
			data: {
				config: { defaultGroup: 'onsite', limit: 6, recommendedSearches: ['团队协作', '设计资源'] }
			}
		});
		expect(
			validateHomeModuleInput({
				type: 'search',
				title: '搜索',
				configJson: '{}',
				recommendedSearchesText: ''
			})
		).toMatchObject({ valid: true, data: { config: { recommendedSearches: [] } } });
	});
	it('validates recommendation length, count and JSON types at both input paths', () => {
		for (const recommendedSearches of [
			['x'.repeat(21)],
			Array.from({ length: 9 }, () => '资源'),
			[42],
			[' '],
			'资源'
		])
			expect(
				validateHomeModuleInput({
					type: 'search',
					title: '搜索',
					configJson: JSON.stringify({ recommendedSearches })
				})
			).toMatchObject({ valid: false, errors: { configJson: expect.any(String) } });
		expect(
			validateHomeModuleInput({
				type: 'search',
				title: '搜索',
				configJson: '{}',
				recommendedSearchesText: 'x'.repeat(21)
			})
		).toMatchObject({ valid: false, errors: { recommendedSearchesText: expect.any(String) } });
	});
	it('keeps old modules compatible, tolerates dirty stored data and lets an explicit empty list hide suggestions', () => {
		const module = { id: 1, type: 'search', title: '搜索', sortOrder: 10, config: {} };
		expect(buildHomeModulePlan([module], [])[0].recommendedSearches).toEqual(
			DEFAULT_SEARCH_RECOMMENDATIONS
		);
		expect(
			buildHomeModulePlan(
				[{ ...module, config: { recommendedSearches: [' 团队 ', null, '团队', ''] } }],
				[]
			)[0].recommendedSearches
		).toEqual(['团队']);
		expect(
			buildHomeModulePlan([{ ...module, config: { recommendedSearches: [] } }], [])[0]
				.recommendedSearches
		).toEqual([]);
	});
	it('allows the existing onsite engine and retains validation of external and internal targets', () => {
		const engine = { key: 'site', name: '站内', groupKey: 'onsite' };
		expect(
			validateSearchEngineInput({ ...engine, urlTemplate: '/search?q={query}' })
		).toMatchObject({ valid: true });
		for (const urlTemplate of [
			'/admin?q={query}',
			'//evil.example/?q={query}',
			'javascript:alert({query})',
			'https://127.0.0.1/?q={query}'
		])
			expect(validateSearchEngineInput({ ...engine, urlTemplate })).toMatchObject({ valid: false });
	});
});

describe('resource-first migration', () => {
	it('moves the legacy ranking only and preserves custom order, disabled flags and JSON', () => {
		const sqlite = new DatabaseSync(':memory:');
		try {
			sqlite.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
			sqlite.exec(readFileSync('seeds/initial.sql', 'utf8'));
			sqlite.exec(readFileSync('migrations/0010_home_reference_order.sql', 'utf8'));
			sqlite.exec(
				"INSERT INTO home_modules(type,title,config_json,sort_order,is_enabled) VALUES('ranking','自定义排行','{\"limit\":3}',5,0),('links','快捷入口','{}',25,1)"
			);
			const before = sqlite
				.prepare(
					'SELECT id,type,title,config_json,sort_order,is_enabled FROM home_modules ORDER BY id'
				)
				.all();
			const sql = readFileSync('migrations/0020_home_resource_order.sql', 'utf8');
			sqlite.exec(sql);
			sqlite.exec(sql);
			const after = sqlite
				.prepare(
					'SELECT id,type,title,config_json,sort_order,is_enabled FROM home_modules ORDER BY id'
				)
				.all();
			expect(after).toEqual(
				before.map((row) => ({
					...row,
					sort_order:
						row.type === 'ranking' && row.title === '排行榜' && row.sort_order === 15
							? 100
							: row.sort_order
				}))
			);
			expect(after.find((row) => row.title === '排行榜')?.sort_order).toBe(100);
		} finally {
			sqlite.close();
		}
	});
});
