import { json } from '@sveltejs/kit';
import {
	listScheduledBackups,
	readScheduledBackup,
	type BackupBucket
} from '$lib/server/services/scheduled-backup';
import type { RequestHandler } from './$types';

function bucket(platform: App.Platform | undefined) {
	return platform?.env?.FILES as unknown as BackupBucket | undefined;
}

export const GET: RequestHandler = async ({ platform, url }) => {
	const files = bucket(platform);
	if (!files) return json({ error: '尚未配置备份存储。' }, { status: 503 });
	try {
		const key = url.searchParams.get('key');
		if (key) {
			const content = await readScheduledBackup(files, key);
			if (content === null) return json({ error: '备份不存在。' }, { status: 404 });
			return new Response(content, {
				headers: {
					'content-type': 'application/json; charset=utf-8',
					'content-disposition': `attachment; filename="${key.split('/').pop() ?? 'navinest-backup.json'}"`,
					'cache-control': 'no-store'
				}
			});
		}
		return json({ data: await listScheduledBackups(files) });
	} catch (error) {
		console.error('Backup storage read failed', error);
		return json({ error: '备份存储暂时不可用，请稍后重试。' }, { status: 503 });
	}
};
