import { json } from '@sveltejs/kit';
import { requireDatabase } from '$lib/server/db';
import { loadSubmissionQueue, getAdminSubmission } from '$lib/server/services/admin-submissions';
import { listCategories } from '$lib/server/services/categories';
import { listTags } from '$lib/server/services/tags';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	if (!locals.admin?.id) return json({ error: '需要管理员身份。' }, { status: 403 });
	try {
		const db = requireDatabase(platform);
		const [queue, categories, tags] = await Promise.all([
			loadSubmissionQueue(db, url.searchParams),
			listCategories(db, { visibleOnly: false }),
			listTags(db)
		]);
		const id = Number(url.searchParams.get('completed'));
		const completed = Number.isSafeInteger(id) && id > 0 ? await getAdminSubmission(db, id) : null;
		return json({
			data: {
				...queue,
				categories,
				tags,
				completed:
					completed &&
					!completed.processing &&
					['published', 'approved', 'rejected'].includes(completed.status)
						? completed
						: null,
				source: 'database',
				readError: '',
				requestKey: crypto.randomUUID(),
				reviewActorId: locals.admin.id
			}
		});
	} catch (cause) {
		console.error('Failed to refresh submission queue', cause);
		return json({ error: '审核队列暂时无法读取，请稍后刷新。' }, { status: 503 });
	}
};
