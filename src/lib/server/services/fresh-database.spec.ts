import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

function sqlFiles(path: string, pattern: RegExp) {
	return readdirSync(path)
		.filter((name) => pattern.test(name))
		.sort((left, right) => left.localeCompare(right));
}

describe('fresh database initialization', () => {
	it('applies every migration and the seed into an empty database with a valid taxonomy', () => {
		const database = new DatabaseSync(':memory:');
		try {
			for (const name of sqlFiles('migrations', /^\d{4}_[a-z0-9_-]+\.sql$/i))
				database.exec(readFileSync(`migrations/${name}`, 'utf8'));
			const seed = readFileSync('seeds/initial.sql', 'utf8');
			expect(() => database.exec(seed)).not.toThrow();
			expect(() => database.exec(seed)).not.toThrow();
			expect(database.prepare('SELECT COUNT(*) count FROM home_modules').get()).toEqual({
				count: 4
			});
			expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
			expect(
				database.prepare('SELECT COUNT(*) count FROM categories WHERE parent_id IS NULL').get()
			).toEqual({ count: 7 });
			expect(
				database
					.prepare(
						`SELECT parent.slug parent FROM categories child JOIN categories parent ON parent.id=child.parent_id WHERE child.type='site' AND child.slug='frontend-dev'`
					)
					.get()
			).toEqual({ parent: 'dev-tools' });
			expect(
				database
					.prepare(
						`SELECT COUNT(*) count FROM item_tags relation JOIN items item ON item.id=relation.item_id JOIN tags tag ON tag.id=relation.tag_id WHERE item.slug='github' AND tag.slug='dev'`
					)
					.get()
			).toEqual({ count: 1 });
		} finally {
			database.close();
		}
	});
});
