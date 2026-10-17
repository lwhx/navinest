<script lang="ts">
	import { untrack, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { aiConfigFields } from '$lib/ai-service-status';
	import type { listAiProviders } from '$lib/server/services/ai-providers';
	type Provider = Awaited<ReturnType<typeof listAiProviders>>[number];
	let {
		editing,
		initialValues = {},
		defaultPrompt,
		secretConfigured,
		testing = false,
		onDirtyChange = () => {},
		onSavingChange = () => {}
	}: {
		editing: Provider | null;
		initialValues?: Record<string, unknown>;
		defaultPrompt: string;
		secretConfigured: boolean;
		testing?: boolean;
		onDirtyChange?: (dirty: boolean) => void;
		onSavingChange?: (saving: boolean) => void;
	} = $props();
	const baseline = $derived({
		name: editing?.name ?? '',
		model: editing?.model ?? '',
		baseUrl: editing?.baseUrl ?? 'https://api.openai.com/v1',
		apiKey: '',
		timeoutMs: String(editing?.timeoutMs ?? 30000),
		maxSourceChars: String(editing?.maxSourceChars ?? 8000),
		systemPrompt: editing?.systemPrompt ?? defaultPrompt
	});
	let draft = $state(
		untrack(
			() =>
				Object.fromEntries(
					Object.entries(baseline).map(([key, val]) => [
						key,
						typeof initialValues[key] === 'string' ? initialValues[key] : val
					])
				) as Record<keyof typeof aiConfigFields, string>
		)
	);
	let saving = $state(false);
	const changed = $derived(
		(Object.keys(aiConfigFields) as Array<keyof typeof aiConfigFields>).filter(
			(key) => String(draft[key]).trim() !== String(baseline[key]).trim()
		)
	);
	const dirty = $derived(changed.length > 0);
	const needsRetest = $derived(changed.some((key) => key !== 'name'));
	$effect(() => onDirtyChange(dirty));
	$effect(() => onSavingChange(saving));
</script>

<section class="admin-editor" aria-labelledby="ai-editor-title">
	<div class="admin-editor-header">
		<h2 id="ai-editor-title">{editing ? `编辑：${editing.name}` : '新增 AI 服务'}</h2>
		<a href={resolve('/admin/ai-providers')} aria-label="关闭 AI 服务编辑器">关闭</a>
	</div>
	<form
		class="admin-form"
		method="POST"
		action={editing ? `?edit=${editing.id}&/update` : '?create=1&/create'}
		use:enhance={() => {
			saving = true;
			return async ({ result, update }) => {
				if (result.type === 'redirect') draft.apiKey = '';
				try {
					await update({ reset: false, invalidateAll: result.type === 'redirect' });
					if (result.type === 'redirect') {
						await tick();
						draft = { ...baseline };
					}
				} finally {
					saving = false;
				}
			};
		}}
	>
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<fieldset disabled={saving || testing}>
			<legend>基础配置</legend>
			<p class="admin-form-hint">
				先保存，再测试已保存配置，测试通过后显式启用。保存或测试成功都不会自动切换服务。
			</p>
			<div class="admin-form-grid">
				<label
					><span>服务名称</span><input
						name="name"
						required
						maxlength="80"
						bind:value={draft.name}
						placeholder="例如：主服务"
					/></label
				>
				<label
					><span>模型名称</span><input
						name="model"
						required
						maxlength="120"
						bind:value={draft.model}
						placeholder="填写服务商提供的模型标识"
					/></label
				>
				<label class="admin-field-wide"
					><span>API Base URL</span><input
						name="baseUrl"
						aria-label="API Base URL"
						type="url"
						required
						maxlength="2048"
						bind:value={draft.baseUrl}
					/><small class="admin-form-hint"
						>填写 API 根路径，例如 https://api.example.com/v1；不要填写完整的 /chat/completions。</small
					></label
				>
				<label class="admin-field-wide"
					><span>API Key{editing ? `（已保存 ••••${editing.keyHint}，留空保留）` : ''}</span><input
						name="apiKey"
						aria-label="API Key"
						type="password"
						autocomplete="new-password"
						required={!editing}
						bind:value={draft.apiKey}
						placeholder={editing ? '留空保留已保存密钥' : '请输入 API Key'}
					/><small class="admin-form-hint"
						>数据库只保存AES-GCM密文，已保存密钥不会回传浏览器。启用 JavaScript
						时，保存失败保留本页输入；刷新页面后需重新输入未保存的密钥。</small
					></label
				>
			</div>
			<details>
				<summary>高级参数</summary>
				<div class="admin-form-grid">
					<label
						><span>请求超时（毫秒）</span><input
							name="timeoutMs"
							aria-label="请求超时（毫秒）"
							type="number"
							min="5000"
							max="120000"
							bind:value={draft.timeoutMs}
						/><small class="admin-form-hint">默认 30000，即 30 秒。</small></label
					>
					<label
						><span>最大网页正文字符</span><input
							name="maxSourceChars"
							aria-label="最大网页正文字符"
							type="number"
							min="1000"
							max="30000"
							bind:value={draft.maxSourceChars}
						/><small class="admin-form-hint">限制发送给模型的网页正文长度。</small></label
					>
					<label class="admin-field-wide"
						><span>系统提示词</span><textarea
							name="systemPrompt"
							aria-label="系统提示词"
							required
							rows="6"
							maxlength="4000"
							bind:value={draft.systemPrompt}></textarea><small class="admin-form-hint"
							>系统额外附加网页不可信及结构化 JSON 输出约束。</small
						></label
					>
				</div>
			</details>
		</fieldset>
		<div class="change-status" role="status" aria-live="polite">
			{#if dirty}<strong>有未保存的修改</strong>
				<p>已修改：{changed.map((key) => aiConfigFields[key]).join('、')}。</p>
				<p>
					{needsRetest
						? '保存后需重新测试；若正在使用此服务，保存这些参数将停用它。'
						: '仅修改名称不影响测试通过和启用状态。'}
				</p>
			{:else if editing}<p>
					编辑内容与已保存配置一致。{editing.testStatus === 'success'
						? '已保存配置测试通过，可启用。'
						: '已保存配置需要测试通过后才能启用。'}
				</p>
			{:else}<p>填写基础配置后保存，随后进行连接与结构化输出测试。</p>{/if}
		</div>
		<div class="admin-form-actions">
			<button
				type="submit"
				class="admin-primary-button"
				disabled={!secretConfigured || testing || saving}>{saving ? '保存中…' : '保存配置'}</button
			><a class="admin-secondary-button" href={resolve('/admin/ai-providers')}>返回列表</a>
		</div>
	</form>
</section>

<style>
	.admin-editor-header h2 {
		flex: 1;
		min-width: 0;
	}
	.admin-editor-header > a {
		flex-shrink: 0;
		white-space: nowrap;
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	legend {
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 8px;
	}
	details {
		margin-top: 20px;
		border-top: 1px solid var(--admin-border, #d7dde5);
		padding-top: 12px;
	}
	summary {
		cursor: pointer;
		font-weight: 600;
		min-height: 44px;
		display: list-item;
		align-content: center;
	}
	details .admin-form-grid {
		margin-top: 12px;
	}
	.change-status {
		margin: 16px 0;
		padding: 12px;
		background: var(--admin-bg);
		border-radius: 8px;
	}
	.change-status p {
		margin: 4px 0;
	}
</style>
