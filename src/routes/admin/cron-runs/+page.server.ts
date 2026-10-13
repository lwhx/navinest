import { fail } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { isTaskId, nextTaskTime, TASKS } from '$lib/task-monitor';
import { loadTaskMonitor, releaseInterruptedTask } from '$lib/server/services/task-runs';
import { runScheduledJob } from '$lib/server/services/scheduled-jobs';
import type { BackupBucket } from '$lib/server/services/scheduled-backup';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const db = getDatabase(platform);
	const value = url.searchParams.get('task');
	const filter = isTaskId(value) ? value : null;
	const now = new Date();
	let monitor: Awaited<ReturnType<typeof loadTaskMonitor>> = { runs: [], jobs: [] };
	let available = false;
	if (db) {
		try {
			monitor = await loadTaskMonitor(db, filter, now);
			available = true;
		} catch (error) {
			console.error('Task monitor unavailable', error);
		}
	}
	return {
		available,
		filter: filter ?? 'all',
		runs: monitor.runs,
		tasks: TASKS.map((task) => {
			const job = monitor.jobs.find((job) => job.id === task.id);
			return {
				...task,
				nextAt: nextTaskTime(task, now),
				requestKey: crypto.randomUUID(),
				latest: job?.latest ?? null,
				active: job?.active ?? null,
				lastSuccessAt: job?.lastSuccessAt ?? null
			};
		})
	};
};
export const actions: Actions = {
	run: async ({ locals, platform, request }) => {
		if (!locals.admin) return fail(403, { success: false, message: '需要管理员权限。' });
		const form = await request.formData();
		const task = form.get('task');
		const requestKey = String(form.get('requestKey') ?? '');
		if (!isTaskId(task) || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestKey))
			return fail(400, { success: false, message: '补跑参数无效，请刷新页面后重试。' });
		try {
			const result = await runScheduledJob(
				requireDatabase(platform),
				TASKS.find((value) => value.id === task)!.cron,
				Date.now(),
				{
					bucket: platform?.env?.FILES as unknown as BackupBucket | undefined,
					alertWebhookUrl: platform?.env?.ALERT_WEBHOOK_URL,
					request: {
						trigger: 'manual',
						requestKey,
						actor: { id: locals.admin.id, displayName: locals.admin.displayName }
					}
				}
			);
			if (result.job === 'skipped')
				return fail(409, {
					success: false,
					message: '任务正在运行，或这次请求已处理。请刷新查看结果。'
				});
			if (result.job === 'hotnews' && result.status !== 'success')
				return fail(502, {
					success: false,
					message: '热榜补跑已结束，存在刷新失败的来源，请查看执行记录。'
				});
			return { success: true, message: '补跑已完成，执行结果已记录。' };
		} catch (error) {
			console.error('Manual task failed', error);
			return fail(500, {
				success: false,
				message: '补跑未能完成，请查看最新错误记录；如记录不可用，请核对服务日志。'
			});
		}
	},
	release: async ({ locals, platform, request }) => {
		if (!locals.admin) return fail(403, { success: false, message: '需要管理员权限。' });
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isSafeInteger(id) || id <= 0 || form.get('confirmed') !== 'yes')
			return fail(400, { success: false, message: '请先确认任务已经停止。' });
		try {
			const released = await releaseInterruptedTask(requireDatabase(platform), id, {
				id: locals.admin.id,
				displayName: locals.admin.displayName
			});
			if (!released)
				return fail(409, {
					success: false,
					message: '该记录已结束，或运行未满 30 分钟，请刷新核对。'
				});
			return { success: true, message: '运行标记已解除，原记录标为失败。可重新补跑。' };
		} catch (error) {
			console.error('Task release failed', error);
			return fail(500, { success: false, message: '运行标记未能解除，请稍后重试。' });
		}
	}
};
