import { createHash } from 'node:crypto';

/** @param {string | Buffer} content */
export function sha256(content) {
	return createHash('sha256').update(content).digest('hex');
}

const transientPattern = /fetch failed|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up/i;

/** @template T @param {() => T} operation @param {{ attempts?: number; delayMs?: number }} [options] */
export function retrySync(operation, { attempts = 3, delayMs = 500 } = {}) {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return operation();
		} catch (error) {
			const message =
				error instanceof Error
					? `${error.message}\n${'stderr' in error ? error.stderr : ''}`
					: String(error);
			if (attempt >= attempts || !transientPattern.test(message)) throw error;
			if (delayMs > 0)
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs * attempt);
		}
	}
}

/** @param {string[]} names */
export function sortedMigrationNames(names) {
	return names.filter((name) => name.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
}

/**
 * @param {{
 *   createdAt: string;
 *   files: Array<{ path: string; content: string | Buffer }>;
 *   secretNames?: string[];
 *   r2Objects?: Array<Record<string, unknown>>;
 * }} input
 */
export function buildBackupManifest({ createdAt, files, secretNames = [], r2Objects = [] }) {
	return {
		format: 'navinest-disaster-recovery',
		version: 1,
		createdAt,
		files: [...files]
			.sort((a, b) => a.path.localeCompare(b.path))
			.map((file) => ({
				path: file.path,
				bytes: Buffer.byteLength(file.content),
				sha256: sha256(file.content)
			})),
		secretNames: [...secretNames].sort(),
		r2Objects
	};
}
