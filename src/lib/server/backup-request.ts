import { BackupRestoreError } from '$lib/server/services/site-backup';
import { BACKUP_MAX_BYTES } from '$lib/backup-preview';
import type { RequestEvent } from '@sveltejs/kit';
export async function readBackupRequest({
	locals,
	request,
	url
}: Pick<RequestEvent, 'locals' | 'request' | 'url'>) {
	if (!locals.admin) throw new BackupRestoreError('需要管理员权限。', 403);
	if (request.headers.get('origin') !== url.origin)
		throw new BackupRestoreError('请从本站后台检查和恢复备份。', 403);
	if (!request.headers.get('content-type')?.startsWith('application/json'))
		throw new BackupRestoreError('请选择 JSON 备份。', 415);
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > BACKUP_MAX_BYTES) throw new BackupRestoreError('备份不能超过 2 MiB。', 413);
	if (!request.body) throw new BackupRestoreError('备份内容为空。');
	const reader = request.body.getReader(),
		chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > BACKUP_MAX_BYTES) {
				await reader.cancel();
				throw new BackupRestoreError('备份不能超过 2 MiB。', 413);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		bytes.set(c, offset);
		offset += c.length;
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		throw new BackupRestoreError('文件不是有效的 UTF-8 JSON，请检查格式后重选。', 400);
	}
}
