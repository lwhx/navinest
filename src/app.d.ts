// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	interface Env {
		AI_CONFIG_ENCRYPTION_KEY?: string;
		ALLOW_GITHUB_AUTO_PROVISION?: string;
	}

	namespace App {
		interface Locals {
			admin: import('$lib/server/admin-auth').AdminIdentity | null;
			user: import('$lib/server/user-auth').UserIdentity | null;
		}

		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
