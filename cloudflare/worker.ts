import svelteWorker from '../.svelte-kit/cloudflare/_worker.js';
import { runScheduledJob } from '../src/lib/server/services/scheduled-jobs';
import type { BackupBucket } from '../src/lib/server/services/scheduled-backup';

export default {
	fetch(request: Request, env: Env, context: ExecutionContext) {
		return svelteWorker.fetch(request, env, context);
	},
	scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
		console.log({
			event: 'cron.started',
			cron: controller.cron,
			scheduledTime: new Date(controller.scheduledTime).toISOString()
		});
		context.waitUntil(
			runScheduledJob(env.DB, controller.cron, controller.scheduledTime, {
				bucket: env.FILES as unknown as BackupBucket | undefined,
				alertWebhookUrl: env.ALERT_WEBHOOK_URL
			}).then((result) => {
				console.log({
					event: 'cron.completed',
					cron: controller.cron,
					result
				});
			})
		);
	}
} satisfies ExportedHandler<Env>;
