import { describe, expect, it } from 'vitest';
import { sortedMigrationNames } from '../../scripts/backup-lib.mjs';
describe('backup migration discovery', () => {
	it('includes every SQL migration in deterministic order', () => {
		expect(
			sortedMigrationNames([
				'seed.sql',
				'0009_content_taxonomy.sql',
				'notes.txt',
				'0001_initial.sql'
			])
		).toEqual(['0001_initial.sql', '0009_content_taxonomy.sql']);
	});
});
