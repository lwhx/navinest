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
	const key = url.searchParams.get('key');
	if (key) {
		const content = await readScheduledBackup(bucket(platform), key);
		if (content === null) return json({ error: '备份不存在。' }, { status: 404 });
		return new Response(content, {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="${key.split('/').pop() ?? 'navinest-backup.json'}"`,
				'cache-control': 'no-store'
			}
		});
	}
	return json({ data: await listScheduledBackups(bucket(platform)) });
};
