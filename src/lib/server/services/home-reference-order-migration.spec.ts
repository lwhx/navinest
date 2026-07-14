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
