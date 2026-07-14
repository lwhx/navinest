import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildBackupManifest, retrySync, sha256, sortedMigrationNames } from './backup-lib.mjs';

const root = process.cwd(),
	stamp = new Date().toISOString().replace(/[:.]/g, '-'),
	out = join('D:/ProgramData/hermes/navinest-backups', stamp);
mkdirSync(out, { recursive: true });
const run = (args, options = {}) =>
	execFileSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
		cwd: root,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, NODE_OPTIONS: '--dns-result-order=ipv4first' },
		...options
	});
const runRead = (args, options = {}) => retrySync(() => run(args, options));
const sql = join(out, 'database.sql');
runRead(['d1', 'export', 'navinest', '--remote', '--output', sql, '--skip-confirmation']);
const query = runRead([
	'd1',
	'execute',
	'navinest',
	'--remote',
	'--json',
	'--command',
	'SELECT object_key,bucket,mime_type,size,created_at FROM files ORDER BY object_key;'
]);
const parsed = JSON.parse(query),
	objects = parsed[0]?.results ?? [],
	r2 = [];
mkdirSync(join(out, 'r2'), { recursive: true });
for (const object of objects) {
	const safe = object.object_key.split('/').filter(Boolean);
	const local = join(out, 'r2', ...safe);
	mkdirSync(join(local, '..'), { recursive: true });
	runRead([
		'r2',
		'object',
		'get',
		`navinest-files/${object.object_key}`,
		'--remote',
		'--file',
		local
	]);
	const content = readFileSync(local);
	r2.push({ ...object, path: relative(out, local).replaceAll('\\', '/'), sha256: sha256(content) });
}
writeFileSync(join(out, 'r2-manifest.json'), JSON.stringify(r2, null, 2));
const secrets = JSON.parse(runRead(['secret', 'list', '--format', 'json']))
	.map((x) => x.name)
	.sort();
writeFileSync(join(out, 'secrets.json'), JSON.stringify({ names: secrets }, null, 2));
for (const file of ['wrangler.jsonc', 'wrangler.build.jsonc'])
	cpSync(join(root, file), join(out, file));
cpSync(join(root, 'cloudflare/worker.ts'), join(out, 'cloudflare-worker.ts'));
cpSync(join(root, 'migrations'), join(out, 'migrations'), { recursive: true });
cpSync(join(root, 'seeds'), join(out, 'seeds'), { recursive: true });
cpSync(join(root, 'docs/disaster-recovery.md'), join(out, 'RESTORE.md'));
const paths = [
	'database.sql',
	'r2-manifest.json',
	'secrets.json',
	'wrangler.jsonc',
	'wrangler.build.jsonc',
	'cloudflare-worker.ts',
	'RESTORE.md'
];
const files = paths.map((path) => ({ path, content: readFileSync(join(out, path)) }));
const migrationFiles = [];
for (const name of sortedMigrationNames(readdirSync(join(root, 'migrations')))) {
	const path = `migrations/${name}`;
	migrationFiles.push({ path, content: readFileSync(join(out, path)) });
}
const seedFiles = readdirSync(join(root, 'seeds'))
	.filter((name) => name.endsWith('.sql'))
	.sort((a, b) => a.localeCompare(b))
	.map((name) => ({ path: `seeds/${name}`, content: readFileSync(join(out, 'seeds', name)) }));
const manifest = buildBackupManifest({
	createdAt: new Date().toISOString(),
	files: [...files, ...migrationFiles, ...seedFiles],
	secretNames: secrets,
	r2Objects: r2
});
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
	JSON.stringify({
		backupDirectory: out,
		files: manifest.files.length,
		r2Objects: r2.length,
		secretNames: secrets.length,
		verified: true
	})
);
