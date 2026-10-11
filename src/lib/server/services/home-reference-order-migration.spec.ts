import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
describe('homepage reference order migration', () => {
	it('places the ranking module immediately after search and remains idempotent', () => {
		const db = new DatabaseSync(':memory:');
		db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
		db.exec(readFileSync('seeds/initial.sql', 'utf8'));
		const sql = readFileSync('migrations/0010_home_reference_order.sql', 'utf8');
		db.exec(sql);
		db.exec(sql);
		const rows = db
			.prepare('SELECT type,sort_order FROM home_modules WHERE is_enabled=1 ORDER BY sort_order,id')
			.all();
		expect(rows).toEqual([
			{ type: 'search', sort_order: 10 },
			{ type: 'ranking', sort_order: 15 },
			{ type: 'content', sort_order: 20 },
			{ type: 'content', sort_order: 30 }
		]);
	});
});

describe('homepage resource-first seed defaults', () => {
	it('places new rankings after resources and preserves saved module settings on repeat seed', () => {
		const db = new DatabaseSync(':memory:');
		try {
			db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
			const seed = readFileSync('seeds/initial.sql', 'utf8');
			db.exec(seed);
			expect(
				db.prepare('SELECT type,sort_order FROM home_modules ORDER BY sort_order,id').all()
			).toEqual([
				{ type: 'search', sort_order: 10 },
				{ type: 'content', sort_order: 20 },
				{ type: 'content', sort_order: 30 },
				{ type: 'ranking', sort_order: 100 }
			]);
			db.exec(
				"UPDATE home_modules SET sort_order=5,is_enabled=0,config_json='{\"limit\":3}' WHERE type='ranking'"
			);
			db.exec(seed);
			expect(
				db
					.prepare(
						"SELECT sort_order,is_enabled,config_json FROM home_modules WHERE type='ranking'"
					)
					.get()
			).toEqual({ sort_order: 5, is_enabled: 0, config_json: '{"limit":3}' });
		} finally {
			db.close();
		}
	});
});
