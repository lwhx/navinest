import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
describe('content taxonomy migration', () => {
	it('is idempotent and assigns official content to child categories', () => {
		const db = new DatabaseSync(':memory:');
		db.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
		db.exec(readFileSync('migrations/seed.sql', 'utf8'));
		const migration = readFileSync('migrations/0009_content_taxonomy.sql', 'utf8');
		db.exec(migration);
		db.exec(migration);
		expect(db.prepare('SELECT COUNT(*) count FROM categories').get()).toEqual({ count: 17 });
		expect(db.prepare('SELECT COUNT(*) count FROM items').get()).toEqual({ count: 19 });
		expect(
			db
				.prepare(
					"SELECT c.slug category FROM items i JOIN categories c ON c.id=i.category_id WHERE i.slug='github'"
				)
				.get()
		).toEqual({ category: 'code-hosting' });
		expect(
			db
				.prepare(
					"SELECT c.slug category FROM items i JOIN categories c ON c.id=i.category_id WHERE i.slug='visual-studio-code'"
				)
				.get()
		).toEqual({ category: 'code-editors' });
		expect(
			db
				.prepare(
					"SELECT im.meta_value url FROM items i JOIN item_meta im ON im.item_id=i.id AND im.meta_key='site_url' WHERE i.slug='vite'"
				)
				.get()
		).toEqual({ url: 'https://vite.dev' });
		expect(
			db
				.prepare(
					"SELECT COUNT(*) count FROM items WHERE slug IN ('docker','mdn-web-docs','vite','dribbble','coolors','font-awesome','notion','obsidian','raycast','todoist','linear')"
				)
				.get()
		).toEqual({ count: 11 });
		db.close();
	});
});
