import { describe, expect, it } from 'vitest';
import { buildBackupManifest } from '../../../../scripts/backup-lib.mjs';

describe('disaster recovery backup manifest', () => {
	it('records deterministic sha256 checksums without secret values', () => {
		const manifest = buildBackupManifest({
			createdAt: '2026-07-13T02:00:00.000Z',
			files: [
				{ path: 'database.sql', content: 'CREATE TABLE example;' },
				{ path: 'site-backup.json', content: '{"version":1}' }
			],
			secretNames: ['GITHUB_CLIENT_SECRET']
		});
		expect(manifest).toMatchObject({
			format: 'navinest-disaster-recovery',
			version: 1,
			secretNames: ['GITHUB_CLIENT_SECRET']
		});
		expect(manifest.files).toHaveLength(2);
		expect(manifest.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(manifest)).not.toContain('secret_');
	});
});
