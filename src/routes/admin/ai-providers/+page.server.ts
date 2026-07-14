import { fail, redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { parsePositiveId } from '$lib/server/admin-mutations';
import {
	AiProviderError,
	createAiProvider,
	deleteAiProvider,
	disableAiProvider,
	enableAiProvider,
	listAiProviders,
	updateAiProvider
} from '$lib/server/services/ai-providers';
import type { AiProviderInput } from '$lib/server/services/ai-providers';
import type { Actions, PageServerLoad } from './$types';

const DEFAULT_PROMPT =
	'为中文导航站生成准确、简洁、客观的标题、简介、补充说明和标签。禁止广告话术，不得编造网页中不存在的事实。';

function input(form: FormData): AiProviderInput {
	return {
		name: String(form.get('name') ?? ''),
		baseUrl: String(form.get('baseUrl') ?? ''),
		model: String(form.get('model') ?? ''),
		apiKey: String(form.get('apiKey') ?? ''),
		timeoutMs: Number(form.get('timeoutMs') ?? 30000),
		maxSourceChars: Number(form.get('maxSourceChars') ?? 8000),
		systemPrompt: String(form.get('systemPrompt') ?? DEFAULT_PROMPT),
		isEnabled: false
	};
}

function values(form: FormData) {
	const entries = Object.fromEntries(form);
	delete entries.apiKey;
	return entries;
}

export const load: PageServerLoad = async ({ platform, url }) => {
	const database = getDatabase(platform),
		providers = database ? await listAiProviders(database) : [],
		editId = parsePositiveId(url.searchParams.get('edit') ?? '');
	return {
		providers,
		source: database ? ('database' as const) : ('fallback' as const),
		secretConfigured: Boolean(platform?.env?.AI_CONFIG_ENCRYPTION_KEY),
		mode: url.searchParams.has('create') ? 'create' : editId ? 'edit' : null,
		editing: editId ? (providers.find((provider) => provider.id === editId) ?? null) : null,
		defaultPrompt: DEFAULT_PROMPT
	};
};

async function mutate(platform: App.Platform | undefined, request: Request, update: boolean) {
	const form = await request.formData(),
		masterKey = platform?.env?.AI_CONFIG_ENCRYPTION_KEY ?? '';
	if (!masterKey)
		return fail(503, {
			success: false,
			message: '服务器尚未配置AI密钥加密主密钥。',
			values: values(form)
		});
	try {
		const id = parsePositiveId(String(form.get('id') ?? ''));
		if (update && !id) throw new AiProviderError('AI 服务 ID 无效。');
		if (update) await updateAiProvider(requireDatabase(platform), masterKey, id!, input(form));
		else await createAiProvider(requireDatabase(platform), masterKey, input(form));
	} catch (error) {
		return fail(400, {
			success: false,
			message: error instanceof AiProviderError ? error.message : 'AI 服务保存失败。',
			values: values(form)
		});
	}
	redirect(303, `/admin/ai-providers?${update ? 'updated' : 'created'}=1`);
}

export const actions: Actions = {
	create: ({ platform, request }) => mutate(platform, request, false),
	update: ({ platform, request }) => mutate(platform, request, true),
	delete: async ({ platform, request }) => {
		const form = await request.formData(),
			id = parsePositiveId(String(form.get('id') ?? ''));
		if (!id) return fail(400, { success: false, message: 'AI 服务 ID 无效。' });
		try {
			await deleteAiProvider(requireDatabase(platform), id);
		} catch (error) {
			return fail(400, {
				success: false,
				message: error instanceof AiProviderError ? error.message : '删除失败。'
			});
		}
		redirect(303, '/admin/ai-providers?deleted=1');
	},
	enable: async ({ platform, request }) => {
		const id = parsePositiveId(String((await request.formData()).get('id') ?? ''));
		if (!id) return fail(400, { success: false, message: 'AI 服务 ID 无效。' });
		try {
			await enableAiProvider(requireDatabase(platform), id);
		} catch (error) {
			return fail(400, {
				success: false,
				message: error instanceof AiProviderError ? error.message : '启用失败。'
			});
		}
		redirect(303, '/admin/ai-providers?enabled=1');
	},
	disable: async ({ platform, request }) => {
		const id = parsePositiveId(String((await request.formData()).get('id') ?? ''));
		if (!id) return fail(400, { success: false, message: 'AI 服务 ID 无效。' });
		try {
			await disableAiProvider(requireDatabase(platform), id);
		} catch (error) {
			return fail(400, {
				success: false,
				message: error instanceof AiProviderError ? error.message : '停用失败。'
			});
		}
		redirect(303, '/admin/ai-providers?disabled=1');
	}
};
