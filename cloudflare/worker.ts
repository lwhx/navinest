import svelteWorker from '../.svelte-kit/cloudflare/_worker.js';
import { refreshEnabledHotSources } from '../src/lib/server/services/hotnews';
import { executeMonitoredHotnewsCron } from '../src/lib/server/services/cron-health';

export default {
	fetch(request: Request, env: Env, context: ExecutionContext) {
		return svelteWorker.fetch(request, env, context);
	},
	scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
		console.log({
			event: 'hotnews.cron.started',
			cron: controller.cron,
			scheduledTime: new Date(controller.scheduledTime).toISOString()
		});
		context.waitUntil(
			executeMonitoredHotnewsCron(env.DB, controller.cron, controller.scheduledTime, () =>
				refreshEnabledHotSources(env.DB)
			).then((run) => {
				console.log({
					event: 'hotnews.cron.completed',
					cron: controller.cron,
					run
				});
				for (const result of run.results) {
					if (!result.ok)
						console.error(`Hot source ${result.sourceId} refresh failed: ${result.error}`);
				}
			})
		);
	}
} satisfies ExportedHandler<Env>;
