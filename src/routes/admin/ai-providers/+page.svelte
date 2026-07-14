<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let testingId = $state<number | null>(null),
		notice = $state('');
	function value(name: string, fallback = '') {
		const current = form?.values?.[name];
		return typeof current === 'string' ? current : fallback;
	}
	async function testProvider(id: number) {
		testingId = id;
		notice = '正在测试AI服务连接与结构化输出…';
		try {
			const response = await fetch(`/api/admin/ai-providers/${id}/test`, { method: 'POST' }),
				body = await response.json();
			notice = response.ok
				? `连接成功，模型 ${body.model}，耗时 ${body.latencyMs}ms。`
				: body.error;
			if (response.ok) setTimeout(() => location.reload(), 500);
		} catch {
			notice = '连接测试失败，请检查网络和服务地址。';
		} finally {
			testingId = null;
		}
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">AI Infrastructure</p>
		<h1>AI 服务</h1>
		<span>配置兼容OpenAI协议的内容生成服务。</span>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/ai-providers?create=1')}>新增AI服务</a
		>{/if}
</header>

{#if !data.secretConfigured}<p class="admin-notice" role="alert">
		服务器尚未配置 <code>AI_CONFIG_ENCRYPTION_KEY</code>。在配置前不能保存或解密API Key。
	</p>{/if}
{#if notice}<p class="admin-form-message" role="status">{notice}</p>{/if}
{#if form?.message}<p class="admin-form-message" role="alert">{form.message}</p>{/if}

{#if data.source === 'database' && data.mode}<section class="admin-editor">
		<div class="admin-editor-header">
			<div>
				<p class="eyebrow">Provider</p>
				<h2>{data.mode === 'create' ? '新增AI服务' : `编辑：${data.editing?.name ?? ''}`}</h2>
			</div>
			<a href={resolve('/admin/ai-providers')}>×</a>
		</div>
		{#if data.mode === 'create' || data.editing}<form
				class="admin-form"
				method="POST"
				action={data.mode === 'create' ? '?create=1&/create' : `?edit=${data.editing?.id}&/update`}
			>
				{#if data.editing}<input type="hidden" name="id" value={data.editing.id} />{/if}
				<div class="admin-form-grid">
					<label
						><span>服务名称</span><input
							name="name"
							required
							maxlength="80"
							value={value('name', data.editing?.name)}
							placeholder="例如：OpenAI 主服务"
						/></label
					>
					<label
						><span>模型名称</span><input
							name="model"
							required
							maxlength="120"
							value={value('model', data.editing?.model)}
							placeholder="gpt-4.1-mini"
						/></label
					>
					<label class="admin-field-wide"
						><span>API Base URL</span><input
							name="baseUrl"
							type="url"
							required
							maxlength="2048"
							value={value('baseUrl', data.editing?.baseUrl ?? 'https://api.openai.com/v1')}
						/><small class="admin-form-hint">填写到v1层级，系统会调用 /chat/completions。</small
						></label
					>
					<label class="admin-field-wide"
						><span
							>API Key {#if data.editing}（当前 ••••{data.editing
									.keyHint}；留空表示保留）{/if}</span
						><input
							name="apiKey"
							type="password"
							autocomplete="new-password"
							required={data.mode === 'create'}
							placeholder={data.mode === 'create' ? '请输入API Key' : '留空保留现有Key'}
						/><small class="admin-form-hint"
							>浏览器不会读取已保存Key；数据库只保存AES-GCM密文。</small
						></label
					>
					<label
						><span>请求超时（毫秒）</span><input
							name="timeoutMs"
							type="number"
							min="5000"
							max="120000"
							value={value('timeoutMs', String(data.editing?.timeoutMs ?? 30000))}
						/></label
					>
					<label
						><span>最大网页正文字符</span><input
							name="maxSourceChars"
							type="number"
							min="1000"
							max="30000"
							value={value('maxSourceChars', String(data.editing?.maxSourceChars ?? 8000))}
						/></label
					>
					<label class="admin-field-wide"
						><span>系统提示词</span><textarea name="systemPrompt" rows="7" maxlength="4000"
							>{value('systemPrompt', data.editing?.systemPrompt ?? data.defaultPrompt)}</textarea
						><small class="admin-form-hint">系统会额外添加网页内容不可信和严格JSON输出约束。</small
						></label
					>
				</div>
				<p class="admin-form-hint">保存后请先执行连接测试；只有测试通过的服务才能启用。</p>
				<div class="admin-form-actions">
					<button class="admin-primary-button" type="submit" disabled={!data.secretConfigured}
						>保存AI服务</button
					><a class="admin-secondary-button" href={resolve('/admin/ai-providers')}>取消</a>
				</div>
			</form>{/if}
	</section>{/if}

<div class="admin-table-wrap">
	<table class="admin-table">
		<thead
			><tr><th>服务</th><th>模型</th><th>API地址</th><th>密钥</th><th>状态</th><th>操作</th></tr
			></thead
		><tbody>
			{#each data.providers as provider (provider.id)}<tr>
					<td><strong>{provider.name}</strong></td><td>{provider.model}</td><td
						>{provider.baseUrl}</td
					><td>••••{provider.keyHint}</td><td>
						<span class="status-badge">{provider.isEnabled ? '使用中' : '停用'}</span>
						<small
							>{provider.testStatus === 'success'
								? `测试通过${provider.testedAt ? ` · ${provider.testedAt}` : ''}`
								: provider.testStatus === 'failed'
									? `测试失败${provider.testError ? ` · ${provider.testError}` : ''}`
									: '尚未测试'}</small
						>
					</td>
					<td
						><div class="admin-row-actions">
							<button
								type="button"
								disabled={testingId !== null || !data.secretConfigured}
								onclick={() => testProvider(provider.id)}
								>{testingId === provider.id ? '测试中…' : '测试连接'}</button
							>{#if provider.isEnabled}<form method="POST" action="?/disable">
									<input type="hidden" name="id" value={provider.id} /><button type="submit"
										>停用</button
									>
								</form>{:else if provider.testStatus === 'success'}<form
									method="POST"
									action="?/enable"
								>
									<input type="hidden" name="id" value={provider.id} /><button type="submit"
										>启用</button
									>
								</form>{/if}<a href={resolve(`/admin/ai-providers?edit=${provider.id}`)}>编辑</a>
							<form
								method="POST"
								action="?/delete"
								onsubmit={(event) => {
									if (!confirm(`确定删除AI服务“${provider.name}”吗？`)) event.preventDefault();
								}}
							>
								<input type="hidden" name="id" value={provider.id} /><button type="submit"
									>删除</button
								>
							</form>
						</div></td
					>
				</tr>{:else}<tr
					><td colspan="6">尚未配置AI服务。未配置时投稿仍可使用网页信息抓取和手动填写。</td></tr
				>{/each}
		</tbody>
	</table>
</div>
